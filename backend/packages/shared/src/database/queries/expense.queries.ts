// ===========================================
// Expense Table Queries
// ===========================================

export const ExpenseQueries = {
  // Select queries
  SELECT: {
    BY_ID: `
      SELECT id, group_id, created_by_id, description, total_amount, currency, split_type, paid_by_id, created_at, settled_at
      FROM expenses 
      WHERE id = $1
    `,

    BY_GROUP: `
      SELECT id, description, total_amount, currency, split_type, paid_by_id, created_at, settled_at
      FROM expenses 
      WHERE group_id = $1 
      ORDER BY created_at DESC
    `,

    BY_GROUP_PAGINATED: `
      SELECT id, description, total_amount, currency, split_type, paid_by_id, created_at, settled_at
      FROM expenses 
      WHERE group_id = $1 
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,

    COUNT_BY_GROUP: `
      SELECT COUNT(*) as count FROM expenses WHERE group_id = $1
    `,

    UNSETTLED_BY_GROUP: `
      SELECT id, description, total_amount, currency, split_type, paid_by_id, created_at
      FROM expenses 
      WHERE group_id = $1 AND settled_at IS NULL
      ORDER BY created_at DESC
    `,
  },

  // Insert queries
  INSERT: {
    EXPENSE: `
      INSERT INTO expenses (id, group_id, created_by_id, description, total_amount, currency, split_type, paid_by_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `,
  },

  // Update queries
  UPDATE: {
    SETTLED: `
      UPDATE expenses 
      SET settled_at = NOW() 
      WHERE id = $1
    `,
  },

  // Delete queries
  DELETE: {
    BY_ID: `
      DELETE FROM expenses WHERE id = $1
    `,
  },
} as const;

// ===========================================
// Expense Splits Queries
// ===========================================

export const ExpenseSplitQueries = {
  // Select queries
  SELECT: {
    BY_EXPENSE: `
      SELECT id, expense_id, user_id, amount, percentage, is_paid, paid_at
      FROM expense_splits 
      WHERE expense_id = $1
    `,

    BY_EXPENSE_AND_USER: `
      SELECT id, expense_id, user_id, amount, percentage, is_paid, paid_at
      FROM expense_splits 
      WHERE expense_id = $1 AND user_id = $2
    `,

    UNPAID_BY_USER: `
      SELECT es.id, es.expense_id, es.amount, e.description, e.currency
      FROM expense_splits es
      INNER JOIN expenses e ON es.expense_id = e.id
      WHERE es.user_id = $1 AND es.is_paid = false
    `,
  },

  // Insert queries
  INSERT: {
    SPLIT: `
      INSERT INTO expense_splits (id, expense_id, user_id, amount, is_paid)
      VALUES ($1, $2, $3, $4, $5)
    `,

    SPLIT_WITH_PERCENTAGE: `
      INSERT INTO expense_splits (id, expense_id, user_id, amount, percentage, is_paid)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
  },

  // Update queries
  UPDATE: {
    PAID: `
      UPDATE expense_splits 
      SET is_paid = true, paid_at = NOW() 
      WHERE id = $1
    `,
  },

  // Delete queries
  DELETE: {
    BY_EXPENSE: `
      DELETE FROM expense_splits WHERE expense_id = $1
    `,
  },
} as const;

// ===========================================
// Ledger Entries Queries (Immutable)
// ===========================================

export const LedgerQueries = {
  // Select queries
  SELECT: {
    BY_GROUP: `
      SELECT id, group_id, expense_id, from_user_id, to_user_id, amount, currency, type, description, created_at
      FROM ledger_entries 
      WHERE group_id = $1
      ORDER BY created_at DESC
    `,

    BY_GROUP_PAGINATED: `
      SELECT id, group_id, expense_id, from_user_id, to_user_id, amount, currency, type, description, created_at
      FROM ledger_entries 
      WHERE group_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,

    BY_USER_IN_GROUP: `
      SELECT id, group_id, expense_id, from_user_id, to_user_id, amount, currency, type, description, created_at
      FROM ledger_entries 
      WHERE group_id = $1 AND (from_user_id = $2 OR to_user_id = $2)
      ORDER BY created_at DESC
    `,

    BALANCES_BY_GROUP: `
      SELECT 
        user_id,
        COALESCE(SUM(CASE WHEN to_user_id = user_id THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_user_id = user_id THEN amount ELSE 0 END), 0) as net_balance
      FROM ledger_entries, group_members
      WHERE ledger_entries.group_id = $1 AND group_members.group_id = $1
      GROUP BY user_id
    `,

    BALANCE_BETWEEN_USERS: `
      SELECT 
        COALESCE(SUM(CASE WHEN from_user_id = $2 AND to_user_id = $3 THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_user_id = $3 AND to_user_id = $2 THEN amount ELSE 0 END), 0) as balance
      FROM ledger_entries 
      WHERE group_id = $1
    `,
  },

  // Insert queries (Ledger is append-only)
  INSERT: {
    ENTRY: `
      INSERT INTO ledger_entries (id, group_id, expense_id, from_user_id, to_user_id, amount, currency, type, description, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    `,

    SETTLEMENT: `
      INSERT INTO ledger_entries (id, group_id, from_user_id, to_user_id, amount, currency, type, description, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'settlement', 'Settlement', NOW())
    `,
  },
} as const;
