-- SupportHub local integrated stack: starter categories only.
-- Demo user accounts are created by setup-supporthub.sh with a password
-- generated at setup time (never committed).
INSERT INTO categories (name) VALUES
  ('Account Support'), ('Technical Support'), ('Billing Support'), ('General Support')
ON CONFLICT (name) DO NOTHING;
