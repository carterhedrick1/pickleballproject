# Textbelt key rotation — email to send

Textbelt has no self-service key rotation, so replacing an exposed key means asking support to
issue a new one and move the remaining credits across. Send this to **support@textbelt.com**.

Do **not** paste the full old key into the email body — support can identify the account from the
purchase email address, and the first/last few characters are enough to disambiguate. If they ask
for the whole key, that is fine; they already have it.

---

**To:** support@textbelt.com
**Subject:** Request to replace an exposed API key and transfer remaining quota

Hello,

I need to replace one of my API keys. It was accidentally exposed, and while I have no evidence
it has been used by anyone else, I would rather not leave it live.

- Account email: shedrick@beapro.com
- Key in question: starts `9439`, ends `iS6y`
- Quota remaining on it: 4,794 texts (confirmed today via the quota endpoint)

Could you please:

1. Issue a new API key for this account
2. Transfer the 4,794 remaining texts to the new key
3. Deactivate the old key once the transfer is done

If the transfer and deactivation have to happen at different times, I would rather the new key be
issued first so I can switch over before the old one stops working.

Thanks very much,
Scott Hedrick

---

## When the new key arrives

Two places need it, and nothing else:

1. `TEXTBELT_API_KEY` in the local `.env`
2. `TEXTBELT_API_KEY` in Render → Pickle Play → Environment (this restarts the service)

Then confirm the new key carries the credits:

    npm run quota

It records each reading to `.textbelt-quota-log`, so a first reading on the new key becomes the
new baseline. Check that the number matches what was on the old key.

## Until then

Run `npm run quota` every day or two. The quota only moves when a text is actually sent, so any
drop you cannot account for means someone else has the key. It sat at 4,794 unchanged across a
full day of verification work, which is what a healthy reading looks like.
