# Aai Matha Light House — delivery-date email setup

## What this bundle changes
- Checkout requires a customer email and sends it to the existing `create-order` Edge Function.
- New orders are saved as `Pending` and include `customer_email`.
- Admin orders show the email and delivery date.
- Admin selects an expected delivery date and clicks **Confirm + Email**.
- The `confirm-order` Edge Function checks the signed-in user against `public.admin_users`, saves status/date using the service key, and sends an email through Resend.

## Setup order
1. Back up your current `index.html`, `admin.html`, and Edge Function code.
2. Run `01_database_migration.sql` in Supabase SQL Editor.
3. Replace the GitHub repository's `index.html` with this bundle's `index.html` (it is based on your `Aai_Matha_Light_House_FINAL_fixed.html` source) and replace `admin.html` with this bundle's `admin.html`. Commit both.
4. In Supabase Edge Functions, replace the code for `create-order` with `create-order/index.ts` and deploy it.
5. Create a new Edge Function named `confirm-order`, paste `confirm-order/index.ts`, and deploy it.
6. In Supabase Edge Function secrets, set:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_ANON_KEY` = your project's publishable/anon key
   - `ORDER_SERVICE_ROLE_KEY` = service-role/secret key (secret only; never put it in website code)
   - `RESEND_API_KEY` = API key from Resend
   - `EMAIL_FROM` = a sender address/domain verified in Resend, e.g. `Aai Matha Light House <orders@your-verified-domain.com>`
7. Verify your sending domain in Resend. Do not use an unverified sender address.
8. Test with a new order using an email address you can access. Existing orders won't have email addresses and cannot receive this email.
9. In Admin Panel, select a delivery date and click **Confirm + Email**. Check the email inbox and spam folder.

## Important
- The email is sent when an admin confirms the order and selects a delivery date, not when the customer first places the order.
- This implementation uses a server-side Edge Function; API secrets are not exposed in `index.html` or `admin.html`.
- The date is the date the admin selects. It is not automatically guaranteed by a courier system.
- `create-order` uses `status: "Pending"` for new orders, matching the admin dashboard text.
- If your GitHub Pages homepage isn't the fixed HTML file above, merge the email field and `placeOrder()` changes into the actual published `index.html` instead of overwriting unrelated newer changes.
