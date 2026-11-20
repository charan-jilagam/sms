# Finance manual

## Fee cycle
1. **Fee structure**: Fees → Fee structure → Fee head (class, name, term, amount, due date, optional late-fee %).
2. **Generate invoices**: one click per fee head. Students who already have it are skipped, and parents are notified.
3. **Collect**: Fees → Invoices → **Collect** (cash, UPI, card, net banking, cheque). A receipt number is issued instantly. Double clicks are safe (idempotent). Parents may also pay online.
4. **Concession**: tag icon on the invoice. Reason is kept in the audit trail.
5. **Late fees** are applied by the nightly job. Only the admin can waive one.

Receipts are immutable: payments cannot be edited or deleted, only refunded by the admin.

## Cash book → bank
Finance → **Cash book**: one day's collections by mode and how much cash is not yet banked.

Finance → **Bank deposits**:
1. Select un-banked cash receipts → **Create deposit**.
2. **Handed to clerk**
3. **Submit bank slip** (slip number)
4. The **admin verifies** (or rejects, in which case resubmit).

Each step is logged and the admin is notified when a slip is waiting.

## Expenses & budgets
* Add expenses by category and vendor, paid or pending. Export to CSV.
* **Budgets**: set a yearly amount per category. The bars show spent versus budget and the admin is alerted when a category goes over.
* Fiscal year start month is in Settings.

## Student ledger
Fees (parent view) and the invoice list give each student's ledger: opening balance, debits, credits, closing balance.

## Reports
Reports → fee collection (by day / month / mode / class / fee head), outstanding dues (with days overdue), expenses by category. Export CSV.

## Payroll
Open HRMS & Payroll → Payroll. Finance can review, adjust and finalize runs and mark them paid.
