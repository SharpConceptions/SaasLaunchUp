import assert from "node:assert/strict";
import test from "node:test";
import { oauthConfigured, oauthProviderSummary, oauthProviders } from "../lib/oauth-providers.ts";

test("OAuth provider readiness requires both client ID and client secret", () => {
  const config = oauthProviders.meta;
  assert.equal(oauthConfigured(config, {}), false);
  assert.equal(oauthConfigured(config, { META_OAUTH_CLIENT_ID: "client-id" }), false);
  assert.equal(oauthConfigured(config, { META_OAUTH_CLIENT_SECRET: "client-secret" }), false);
  assert.equal(oauthConfigured(config, { META_OAUTH_CLIENT_ID: "client-id", META_OAUTH_CLIENT_SECRET: "client-secret" }), true);
});

test("every clickable OAuth provider has explicit endpoints, scopes, and setup variables", () => {
  for (const [key, config] of Object.entries(oauthProviders)) {
    assert.equal(config.provider, key);
    assert.match(config.authorizationEndpoint, /^https:\/\//);
    assert.match(config.tokenEndpoint, /^https:\/\//);
    assert.match(config.profileEndpoint, /^https:\/\//);
    assert.ok(["GET", "POST"].includes(config.tokenMethod));
    assert.ok(config.scopes.length > 0);
    assert.ok(config.clientIdEnv.endsWith("_OAUTH_CLIENT_ID"));
    assert.ok(config.clientSecretEnv.endsWith("_OAUTH_CLIENT_SECRET"));
  }
});

test("OAuth status exposes configuration and requested scopes but no credentials", () => {
  const appOnly = oauthProviderSummary({ GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret" });
  assert.equal(appOnly["google-calendar"].configured, false);
  assert.equal(appOnly["google-calendar"].app_configured, true);
  const status = oauthProviderSummary({ GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret", INTEGRATION_ENCRYPTION_KEY: "encoded-key" });
  assert.equal(status["google-calendar"].configured, true);
  assert.deepEqual(status["google-calendar"].scopes, ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.events"]);
  assert.equal(status.meta.configured, false);
  assert.equal(JSON.stringify(status).includes("client_secret"), false);
});

test("Meta uses its query-based token exchange and social providers require PKCE where supported", () => {
  assert.equal(oauthProviders.meta.tokenMethod, "GET");
  assert.equal(oauthProviders.meta.pkce, false);
  assert.equal(oauthProviders.meta.tokenGrantType, false);
  for (const provider of ["google-workspace", "google-calendar", "google-ads", "linkedin", "x"]) {
    assert.equal(oauthProviders[provider].tokenMethod, "POST");
    assert.equal(oauthProviders[provider].pkce, true);
  }
  assert.equal(oauthProviders.reddit.tokenMethod, "POST");
  assert.equal(oauthProviders.reddit.pkce, false);
});
