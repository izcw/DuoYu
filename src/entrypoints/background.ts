import { browser } from 'wxt/browser';
import { websiteTitle } from '../features/library/website-title';
import { launchLoginWindow } from '../features/auth/login-window';
import {
  AUTH_SESSION_KEY,
  authConfig,
  type Account,
  type AuthView,
} from '../features/auth/config';
import {
  AuthError,
  discovery,
  random,
  challenge,
  callbackCode,
  exchange,
  verifyID,
  userInfo,
  revoke,
} from '../features/auth/protocol';

interface Session {
  clientId?: string;
  account: Account;
  access: string;
  identity?: string;
  refresh?: string;
  expires: number;
  refreshPending?: boolean;
}
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== browser.runtime.id ||
      sender.url !== browser.runtime.getURL('/newtab.html') ||
      message?.type !== 'website-title'
    )
      return;
    void (async () => {
      try {
        const url = new URL(message.url);
        const existing = (await browser.tabs.query({})).find(
          (tab) => tab.url === url.href && tab.title && tab.title !== url.href,
        );
        if (existing?.title) {
          respond({ title: existing.title });
          return;
        }
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error();
        if (
          !(await browser.permissions.contains({
            origins: [url.origin + '/*'],
          }))
        )
          throw new Error();
        const response = await fetch(url.href, {
          credentials: 'omit',
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`网站返回 HTTP ${response.status}`);
        const html = (await response.text()).slice(0, 500000);
        respond({
          title: websiteTitle(html, url),
          error:
            '网站可能需要执行脚本或完成访问校验，请先打开该网页，再点击获取标题',
        });
      } catch {
        respond({
          title: '',
          error:
            '无法读取网页，请确认已重新加载扩展并授权网站访问；也可先在浏览器打开该网址后重试',
        });
      }
    })();
    return true;
  });

  // Persist only renewal credentials; access tokens remain session-only.
  const renewalKey = AUTH_SESSION_KEY + 'Renewal';
  const ready = Promise.all([
    browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
  let queue: Promise<unknown> = Promise.resolve();
  let loggingIn = false;
  async function read(): Promise<Session | undefined> {
    await ready;
    let session = (await browser.storage.session.get(AUTH_SESSION_KEY))[
      AUTH_SESSION_KEY
    ] as Session | undefined;
    if (!session) {
      const renewal = (await browser.storage.local.get(renewalKey))[
        renewalKey
      ] as
        | Pick<Session, 'account' | 'refresh' | 'refreshPending' | 'clientId'>
        | undefined;
      if (renewal) session = { ...renewal, access: '', expires: 0 };
    }
    if (
      session &&
      (session.account.issuer !== authConfig.issuer ||
        session.clientId !== authConfig.clientId)
    ) {
      await clear();
      return undefined;
    }
    return session;
  }
  async function save(session: Session) {
    await ready;
    if (session.refresh) {
      await browser.storage.local.set({
        [renewalKey]: {
          account: session.account,
          refresh: session.refresh,
          refreshPending: session.refreshPending ?? false,
          clientId: authConfig.clientId,
        },
      });
    } else await browser.storage.local.remove(renewalKey);
    await browser.storage.session.set({
      [AUTH_SESSION_KEY]: { ...session, clientId: authConfig.clientId },
    });
  }
  async function clear() {
    await browser.storage.local.remove(renewalKey);
    await browser.storage.session.remove(AUTH_SESSION_KEY);
  }
  async function status(): Promise<AuthView> {
    let s = await read();
    if (!s) return { account: null };
    if (s.refreshPending) {
      await clear();
      return { account: null, warning: '上次登录续期结果不确定，请重新登录' };
    }
    try {
      if (s.expires <= Date.now() + 30000) {
        if (!s.refresh) {
          await clear();
          return { account: null, warning: '登录已过期，请重新登录' };
        }
        // Never retry a refresh whose response was lost: the server may already
        // have consumed it, and replay would revoke the entire token family.
        let t;
        // Persist before sending: worker termination must not replay an old token.
        await save({ ...s, refreshPending: true });
        try {
          t = await exchange({
            grant_type: 'refresh_token',
            refresh_token: s.refresh,
          });
          if (t.id_token) await verifyID(t.id_token, undefined, s.account.sub);
        } catch {
          throw new AuthError('登录续期未完成，请重新登录', true);
        }
        if (!t.refresh_token)
          throw new AuthError('账号服务未返回轮换令牌', true);
        s = {
          ...s,
          access: t.access_token,
          identity: t.id_token,
          refresh: t.refresh_token,
          refreshPending: false,
          expires: Date.now() + t.expires_in * 1000,
        };
        // Persist rotated refresh token before any subsequent network call.
        await save(s);
      }
      s.account = await userInfo(s.access, s.account.sub);
      await save(s);
      return { account: s.account };
    } catch (e) {
      if (e instanceof AuthError && e.invalidSession) {
        await clear();
        return { account: null, warning: e.message };
      }
      return {
        account: s.expires > Date.now() ? s.account : null,
        warning:
          e instanceof AuthError
            ? e.message
            : '暂时无法验证登录状态，请检查账号服务连接',
      };
    }
  }
  async function login(parentWindowId?: number): Promise<AuthView> {
    const d = await discovery(),
      state = random(),
      nonce = random(),
      verifier = random();
    const redirect = browser.identity.getRedirectURL('oidc');
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: authConfig.clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: authConfig.scope,
      state,
      nonce,
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'consent',
    }).toString();
    let callback: string | undefined;
    try {
      callback = await launchLoginWindow(url.href, parentWindowId);
    } catch {
      throw new AuthError('登录窗口已关闭或授权未完成，可重新登录');
    }
    if (!callback) throw new AuthError('登录未完成');
    const code = callbackCode(callback, redirect, state);
    const t = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
    });
    try {
      if (!t.id_token) throw new AuthError('账号服务未返回身份令牌');
      const sub = await verifyID(t.id_token, nonce);
      const account = await userInfo(t.access_token, sub);
      await save({
        account,
        access: t.access_token,
        identity: t.id_token,
        refresh: t.refresh_token,
        expires: Date.now() + t.expires_in * 1000,
      });
      return { account };
    } catch (e) {
      await Promise.allSettled([
        revoke(t.access_token, 'access_token'),
        ...(t.refresh_token ? [revoke(t.refresh_token, 'refresh_token')] : []),
      ]);
      throw e instanceof AuthError
        ? e
        : new AuthError('登录身份校验失败，请重新登录');
    }
  }
  async function logout(): Promise<AuthView> {
    const s = await read();
    await clear();
    if (!s) return { account: null };
    const results = await Promise.allSettled([
      revoke(s.access, 'access_token'),
      ...(s.refresh ? [revoke(s.refresh, 'refresh_token')] : []),
    ]);
    return {
      account: null,
      warning: results.some((r) => r.status === 'rejected')
        ? '已退出登录；账号服务暂不可用，远端令牌未确认撤销'
        : undefined,
    };
  }
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== browser.runtime.id ||
      sender.url !== browser.runtime.getURL('/newtab.html') ||
      message?.type !== 'duoyu-auth'
    )
      return;
    const action = message.action;
    if (!['status', 'login', 'logout', 'sync'].includes(action)) return;
    if (loggingIn) {
      respond({ error: '登录窗口已打开，请先完成或关闭该窗口' });
      return;
    }
    if (action === 'login') loggingIn = true;
    queue = queue.then(async () => {
      try {
        if (action === 'sync') {
          const view = await status();
          const session = await read();
          if (
            !view.account ||
            !session?.identity ||
            message.account?.issuer !== view.account.issuer ||
            message.account?.sub !== view.account.sub
          ) {
            respond({ status: 401, error: '请重新登录后同步' });
            return;
          }
          const path = String(message.path || '');
          if (
            !/^\/v1\/(sync\/(snapshot|changes\?after=\d+|operations)|assets\/[0-9a-f]{64})$/.test(
              path,
            )
          )
            throw new Error('invalid sync path');
          const endpoint = import.meta.env.VITE_SYNC_URL;
          if (!endpoint || !endpoint.startsWith('https://')) {
            respond({ status: 503, error: '云同步服务尚未配置' });
            return;
          }
          const binary = message.binary === true;
          const response = await fetch(endpoint.replace(/\/$/, '') + path, {
            method: message.method === 'POST' ? 'POST' : 'GET',
            headers: {
              Authorization: `Bearer ${session.access}`,
              'X-Duoyu-Identity': session.identity,
              ...(message.method === 'POST'
                ? {
                    'Content-Type': binary
                      ? message.mediaType
                      : 'application/json',
                  }
                : {}),
            },
            body:
              message.method === 'POST'
                ? binary
                  ? Uint8Array.from(atob(message.body), (c) => c.charCodeAt(0))
                  : JSON.stringify(message.body)
                : undefined,
            credentials: 'omit',
            redirect: 'error',
            signal: AbortSignal.timeout(30000),
          });
          if (binary && response.ok && message.method !== 'POST') {
            const bytes = new Uint8Array(await response.arrayBuffer());
            let text = '';
            for (let i = 0; i < bytes.length; i += 8192)
              text += String.fromCharCode(...bytes.subarray(i, i + 8192));
            respond({
              status: response.status,
              data: {
                base64: btoa(text),
                mediaType: response.headers.get('content-type'),
              },
            });
          } else
            respond({
              status: response.status,
              retryAfter: Number(response.headers.get('retry-after') || 0),
              data: await response.json(),
            });
          return;
        }
        respond({
          view: await (action === 'login'
            ? login(sender.tab?.windowId)
            : action === 'logout'
              ? logout()
              : status()),
        });
      } catch (e) {
        respond({
          error:
            e instanceof AuthError
              ? e.message
              : action === 'sync'
                ? '云同步请求失败，请检查网络或稍后重试'
                : '账号服务连接失败，请检查网络或稍后重试',
        });
      } finally {
        if (action === 'login') loggingIn = false;
      }
    });
    return true;
  });
});
