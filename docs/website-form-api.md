# Website form intake API

Create a website connection in **Profile → API connections → Website forms**. Choose the destination pipeline stage and lead owner. SaaS Launchup issues a Site ID and an API key. The key is shown once; rotate it if it is lost. The Twilio Account SID is issued by Twilio and is separate from the Site ID.

## No-code webhook

In your website form builder, add an outgoing **server-side webhook** using the one-copy URL shown when the connection is created. Set the method to `POST`. Send JSON, URL-encoded fields, or multipart form fields. The URL contains the API key, so keep it in server-side settings and never place it in public HTML or browser JavaScript.

The minimum fields are `name` and either `email` or `phone`. Supported standard fields include `company`, `website` or `domain`, `source`, `message`, and `submission_id`. First and last names may be sent separately. Use the connection's field-mapping controls if the builder uses different field names. Send a stable `submission_id` to make retries idempotent.

## Server API

`POST https://api.saaslaunchup.com/api/v1/forms/{SITE_ID}`

Headers:

```text
Authorization: Bearer {API_KEY}
Content-Type: application/json
Idempotency-Key: {unique-form-submission-id}
```

Example body:

```json
{
  "name": "Jordan Lee",
  "email": "jordan@example.com",
  "phone": "+13125550100",
  "company": "Example Co",
  "website": "example.com",
  "message": "Please call me",
  "source": "Contact form"
}
```

A successful new submission returns `201` with `contact_id`, `company_id` (nullable), and `lead_id`. A repeated submission ID returns `200` with `duplicate: true` and the original record IDs. The connection is limited to 120 accepted submissions per minute. A revoked or incorrect key returns `401`.

Contacts are matched within the company workspace by email, or by phone when no email is supplied. Companies are matched by domain or name when those fields are present. The connection creates a new contact and an open opportunity in its configured pipeline stage when no matching open lead exists. Existing contacts and open leads are reused. A submitted message becomes a contact note. The form does not grant SMS or email consent and does not send messages.
