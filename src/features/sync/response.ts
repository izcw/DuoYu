export const RELOAD_SYNC_MESSAGE =
  '扩展后台尚未更新，无法发送云同步请求。请重新加载扩展后重试，待上传数据会保留。';

export class SyncResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Old installed workers can answer known auth messages but silently ignore sync. */
export function syncResponse(response: any) {
  if (!response || (typeof response.status !== 'number' && !response.error))
    throw new SyncResponseError(RELOAD_SYNC_MESSAGE, 426);
  if (response.error || response.status >= 400)
    throw new SyncResponseError(
      response.data?.error ||
        response.error ||
        `云同步请求失败（${response.status}）`,
      response.status || 503,
    );
  if (response.data === undefined)
    throw new SyncResponseError('云同步服务返回了不完整的响应，请重试', 502);
  return response.data;
}

export function syncTransportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|message port closed|Extension context invalidated/i.test(
    message,
  )
    ? new SyncResponseError(RELOAD_SYNC_MESSAGE, 426)
    : error;
}
