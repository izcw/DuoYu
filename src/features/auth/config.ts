// Public OIDC registration; never place a client secret in the extension.
export const authConfig = {
  issuer: import.meta.env.VITE_AUTH_ISSUER.replace(/\/+$/, ''),
  clientId: import.meta.env.VITE_AUTH_CLIENT_ID,
  scope: import.meta.env.VITE_AUTH_SCOPE,
};
export const AUTH_SESSION_KEY = 'duoyuAuthSession';
export interface Account {
  issuer: string;
  sub: string;
  name: string;
  email: string;
  picture: string;
}
export interface AuthView {
  account: Account | null;
  warning?: string;
}
