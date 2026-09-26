# Provider Connections

The API Connections page distinguishes credential verification from an enabled product workflow. A status becomes connected only after credentials are verified or an OAuth callback verifies the provider account. A verified credential does not imply that sending, publishing, payment processing, or DNS changes are enabled.

## Credential Providers

Stripe and Resend use API keys. Submit test credentials first. The API validates the key against the provider, stores it encrypted with AES-GCM in `provider_connections`, and returns only masked identifiers and verification time. The encryption key must be configured as the Cloudflare Worker secret `INTEGRATION_ENCRYPTION_KEY` (base64-encoded 32-byte key).

- Stripe verification checks access to `/v1/account`. Payment webhooks, checkout, subscription sync, and billing state are separate work and are not enabled by connecting a key.
- Resend verification checks access to `/domains`. Email sending stays disabled until sender-domain verification, consent/suppression checks, unsubscribe handling, and delivery callbacks are implemented.
- Twilio retains its existing Account SID/API key verification. Calls and SMS are not enabled by credential verification.

## OAuth Providers

OAuth uses one-time 10-minute state records bound to tenant, user, and provider. PKCE is enabled for Google, LinkedIn, and X; Meta uses its GET authorization-code exchange, while Reddit uses its confidential-client exchange. Tokens are encrypted before persistence and are not returned to browser code. The callback URL must exactly match the registered URL below for the environment. The user must have an active company-owner membership and a live Cloudflare Access session at callback time.

| Provider cards | Cloudflare Worker secrets | Callback path |
| --- | --- | --- |
| Google Workspace, Google Calendar, Google Ads | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `/api/integrations/oauth?callback=1&provider=google-workspace`, `/api/integrations/oauth?callback=1&provider=google-calendar`, `/api/integrations/oauth?callback=1&provider=google-ads` |
| Facebook & Instagram (Meta) | `META_OAUTH_CLIENT_ID`, `META_OAUTH_CLIENT_SECRET` | `/api/integrations/oauth?callback=1&provider=meta` |
| LinkedIn | `LINKEDIN_OAUTH_CLIENT_ID`, `LINKEDIN_OAUTH_CLIENT_SECRET` | `/api/integrations/oauth?callback=1&provider=linkedin` |
| X | `X_OAUTH_CLIENT_ID`, `X_OAUTH_CLIENT_SECRET` | `/api/integrations/oauth?callback=1&provider=x` |
| Reddit | `REDDIT_OAUTH_CLIENT_ID`, `REDDIT_OAUTH_CLIENT_SECRET` | `/api/integrations/oauth?callback=1&provider=reddit` |

Register each callback using the full origin for the desired environment, for example `https://staging.saaslaunchup.com` or `https://saaslaunchup.com`. Register the exact requested scopes shown in the page and obtain any provider review/approval required by the platform. Do not paste client secrets into chat, source files, or browser forms; set them as Worker secrets through the Cloudflare dashboard/secret manager.

OAuth account identity is verified via the provider profile endpoint and tokens are stored, but downstream provider-specific API operations still need separate implementation and real-account tests. Google Ads additionally requires a Google Ads developer token; Meta assets/permissions and LinkedIn organization access depend on the authorized user and app approvals. The cards do not claim publishing, inbox sync, analytics sync, or ad delivery until those operations are implemented and tested.

No provider OAuth client credentials or `INTEGRATION_ENCRYPTION_KEY` are present in the checked-out local environment. Consequently, social cards are clickable and the OAuth code path is implemented, but the start endpoint intentionally reports that setup is unavailable until the app credentials and encryption secret are installed in the target Worker's secret store. Do not present these accounts as connected before a real authorization callback succeeds.

## Domains

Any domain owned by the customer is eligible in principle. This page does not yet verify domain ownership, connect a registrar/DNS account, modify records, configure SPF/DKIM/DMARC, or provision hosting. The domain wording is informational; do not treat a saved primary-domain field as verified ownership.

## Working Now

Website form intake is configured separately under Funnels & Automation → Forms & assessments. Its one-time website key and idempotent form endpoint remain separate from OAuth provider connections. See [website-form-api.md](website-form-api.md).
