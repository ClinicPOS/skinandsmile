# Follow-up failure review

Scope: read-only source review for accidental public-key database access and partial-success follow-up actions. No production query, mutation, push or deployment.

Confirmed public-key lookup defect: patient-note POST receipt, receptionist and doctor lookups used createServerSupabaseClient (anonymous credentials). Local fix uses protected client after session and patient/clinic validation. Prior fake-local test saved a note against a receipt and rejected unauthenticated/foreign clinic/invalid receipt requests.

Other reviewed patient registration/edit/link/file routes and CEO/service reports replace their anonymous session client with createProtectedDataClient before database operations. Note edit/delete already use protected client. No additional identical defect identified in these paths.

Additional risks confirmed in source:
- app/receipts/page.tsx EOD warning branches continue after required financial query failures (payment allocations/refunds, plan payments, balance payments, deposits and deductions). Report can be incomplete; require export abort and a retry message.
- checkout logs a patient-details persistence failure and continues to payment. Receipt may save while edited demographics remain unchanged; warn explicitly without suggesting a second payment.
- cash-deduction create/update persist the financial row and activity event in separate operations; event insert error is unchecked. No activity-event trigger identified in migration sources. Atomic audited operation and safe retry needed; production state not inspected.

Focused patient mutation failure, clinical note authorization and patient mutation security tests pass. This does not establish absence of all defects or occurrence of these additional risks in production.
