AAI MATHA LIGHT HOUSE — CONNECTED WEBSITE STARTER

Files:
- index.html: customer storefront. No Manage Products button. Reads products from Supabase and listens for live updates after configuration.
- admin.html: separate admin login and product manager.
- config.js: paste Supabase Project URL and anon/public key here. Never use service_role key.
- setup.sql: create products table and storage policies.

IMPORTANT: These files are not connected to a real database until you create a Supabase project and fill config.js. Do not publish as a working connected site before completing setup.

SETUP:
1. Create a project at https://supabase.com/dashboard
2. In Project Settings → API, copy Project URL and anon/public key into config.js. Do NOT paste a service_role key.
3. Open SQL Editor, paste and run setup.sql.
4. In Authentication → Users, add your own admin email and set a strong NEW password. Do not reuse any password posted in chat. Keep public sign-ups disabled.
5. Deploy the entire folder on static hosting (the index.html, admin.html, config.js files must stay together).
6. Open /admin.html, sign in, add products and photos. Customers use the normal website URL; admin uses the separate /admin.html URL.
7. Test with a sample product before sharing the customer URL.

SECURITY: The anon/public key is designed for browser use with Row Level Security enabled. Never expose the service_role key. This starter allows authenticated Supabase users to manage products, so create only the shop admin user and disable public sign-ups.

Business details: Aai Matha Light House, Rajiv Gandhi Nagar, Bachupally, Hyderabad, Telangana. WhatsApp: +91 81063 93073. Delivery: ₹50 below ₹5,000; free at ₹5,000 or more.
