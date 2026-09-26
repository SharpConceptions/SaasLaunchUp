export type OAuthProviderKey = "google-workspace" | "google-calendar" | "google-ads" | "meta" | "linkedin" | "x" | "reddit";

export type OAuthProviderConfig = {
  provider: OAuthProviderKey;
  clientIdEnv: string;
  clientSecretEnv: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  profileEndpoint: string;
  tokenMethod: "GET" | "POST";
  tokenGrantType?: string | false;
  scopes: string[];
  pkce: boolean;
  authorizeParams?: Record<string, string>;
  userAgent?: string;
};

const googleScopes = ["openid", "email", "profile"];

export const oauthProviders: Record<OAuthProviderKey, OAuthProviderConfig> = {
  "google-workspace": {
    provider: "google-workspace", clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID", clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth", tokenEndpoint: "https://oauth2.googleapis.com/token",
    profileEndpoint: "https://openidconnect.googleapis.com/v1/userinfo", tokenMethod: "POST",
    scopes: [...googleScopes, "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"], pkce: true,
    authorizeParams: { access_type: "offline", prompt: "consent" },
  },
  "google-calendar": {
    provider: "google-calendar", clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID", clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth", tokenEndpoint: "https://oauth2.googleapis.com/token",
    profileEndpoint: "https://openidconnect.googleapis.com/v1/userinfo", tokenMethod: "POST",
    scopes: [...googleScopes, "https://www.googleapis.com/auth/calendar.events"], pkce: true,
    authorizeParams: { access_type: "offline", prompt: "consent" },
  },
  "google-ads": {
    provider: "google-ads", clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID", clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth", tokenEndpoint: "https://oauth2.googleapis.com/token",
    profileEndpoint: "https://openidconnect.googleapis.com/v1/userinfo", tokenMethod: "POST",
    scopes: [...googleScopes, "https://www.googleapis.com/auth/adwords"], pkce: true,
    authorizeParams: { access_type: "offline", prompt: "consent" },
  },
  meta: {
    provider: "meta", clientIdEnv: "META_OAUTH_CLIENT_ID", clientSecretEnv: "META_OAUTH_CLIENT_SECRET",
    authorizationEndpoint: "https://www.facebook.com/v22.0/dialog/oauth", tokenEndpoint: "https://graph.facebook.com/v22.0/oauth/access_token",
    profileEndpoint: "https://graph.facebook.com/me?fields=id,name", tokenMethod: "GET", tokenGrantType: false, scopes: ["public_profile", "email", "pages_show_list", "pages_read_engagement", "instagram_basic"], pkce: false,
  },
  linkedin: {
    provider: "linkedin", clientIdEnv: "LINKEDIN_OAUTH_CLIENT_ID", clientSecretEnv: "LINKEDIN_OAUTH_CLIENT_SECRET",
    authorizationEndpoint: "https://www.linkedin.com/oauth/v2/authorization", tokenEndpoint: "https://www.linkedin.com/oauth/v2/accessToken",
    profileEndpoint: "https://api.linkedin.com/v2/userinfo", tokenMethod: "POST", scopes: ["openid", "profile", "email", "w_member_social"], pkce: true,
  },
  x: {
    provider: "x", clientIdEnv: "X_OAUTH_CLIENT_ID", clientSecretEnv: "X_OAUTH_CLIENT_SECRET",
    authorizationEndpoint: "https://twitter.com/i/oauth2/authorize", tokenEndpoint: "https://api.x.com/2/oauth2/token",
    profileEndpoint: "https://api.x.com/2/users/me", tokenMethod: "POST", scopes: ["users.read", "tweet.read", "tweet.write", "offline.access"], pkce: true,
  },
  reddit: {
    provider: "reddit", clientIdEnv: "REDDIT_OAUTH_CLIENT_ID", clientSecretEnv: "REDDIT_OAUTH_CLIENT_SECRET",
    authorizationEndpoint: "https://www.reddit.com/api/v1/authorize", tokenEndpoint: "https://www.reddit.com/api/v1/access_token",
    profileEndpoint: "https://oauth.reddit.com/api/v1/me", tokenMethod: "POST", scopes: ["identity", "read", "submit"], pkce: false,
    authorizeParams: { duration: "permanent" }, userAgent: "SaaSLaunchup/1.0",
  },
};

export function oauthConfigured(config: OAuthProviderConfig, environment: Record<string, unknown>) {
  return typeof environment[config.clientIdEnv] === "string" && Boolean(environment[config.clientIdEnv])
    && typeof environment[config.clientSecretEnv] === "string" && Boolean(environment[config.clientSecretEnv]);
}

export function oauthProviderSummary(environment: Record<string, unknown>) {
  const credentialStorageConfigured = typeof environment.INTEGRATION_ENCRYPTION_KEY === "string" && Boolean(environment.INTEGRATION_ENCRYPTION_KEY);
  return Object.fromEntries(Object.values(oauthProviders).map(config => {
    const appConfigured = oauthConfigured(config, environment);
    return [config.provider, { configured: appConfigured && credentialStorageConfigured, app_configured: appConfigured, credential_storage_configured: credentialStorageConfigured, scopes: config.scopes }];
  }));
}
