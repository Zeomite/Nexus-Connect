import { z } from 'zod';

// Split type enum
export const SplitType = {
  EQUAL: 'equal',
  EXACT: 'exact',
  PERCENTAGE: 'percentage',
} as const;

export type SplitTypeValue = (typeof SplitType)[keyof typeof SplitType];

// Expense schema
export const ExpenseSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  createdById: z.string().uuid(),
  description: z.string().min(1).max(200),
  totalAmount: z.number().positive(),
  currency: z.string().length(3),
  splitType: z.enum(['equal', 'exact', 'percentage']),
  paidById: z.string().uuid(),
  createdAt: z.date(),
  settledAt: z.date().nullable(),
});

export type Expense = z.infer<typeof ExpenseSchema>;

// Expense split schema
export const ExpenseSplitSchema = z.object({
  id: z.string().uuid(),
  expenseId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number(),
  percentage: z.number().min(0).max(100).nullable(),
  isPaid: z.boolean(),
  paidAt: z.date().nullable(),
});

export type ExpenseSplit = z.infer<typeof ExpenseSplitSchema>;

// Balance schema
export const BalanceSchema = z.object({
  userId: z.string().uuid(),
  owedToUserId: z.string().uuid(),
  groupId: z.string().uuid(),
  amount: z.number(),
  currency: z.string().length(3),
});

export type Balance = z.infer<typeof BalanceSchema>;

// Ledger entry schema (immutable)
export const LedgerEntrySchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  expenseId: z.string().uuid().nullable(),
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amount: z.number(),
  currency: z.string().length(3),
  type: z.enum(['expense', 'settlement', 'adjustment']),
  description: z.string(),
  createdAt: z.date(),
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

// Create expense input - equal split
export const CreateEqualExpenseSchema = z.object({
  groupId: z.string().uuid(),
  description: z.string().min(1).max(200),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  splitType: z.literal('equal'),
  participantIds: z.array(z.string().uuid()).min(1),
  paidById: z.string().uuid(),
});

// Create expense input - exact split
export const CreateExactExpenseSchema = z.object({
  groupId: z.string().uuid(),
  description: z.string().min(1).max(200),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  splitType: z.literal('exact'),
  splits: z.array(
    z.object({
      userId: z.string().uuid(),
      amount: z.number().positive(),
    })
  ).min(1),
  paidById: z.string().uuid(),
});

// Create expense input - percentage split
export const CreatePercentageExpenseSchema = z.object({
  groupId: z.string().uuid(),
  description: z.string().min(1).max(200),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  splitType: z.literal('percentage'),
  splits: z.array(
    z.object({
      userId: z.string().uuid(),
      percentage: z.number().min(0).max(100),
    })
  ).min(1),
  paidById: z.string().uuid(),
});

export const CreateExpenseSchema = z.discriminatedUnion('splitType', [
  CreateEqualExpenseSchema,
  CreateExactExpenseSchema,
  CreatePercentageExpenseSchema,
]);

export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;

// Record settlement input
export const RecordSettlementSchema = z.object({
  groupId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
});

export type RecordSettlementInput = z.infer<typeof RecordSettlementSchema>;

// Balance summary
export interface UserBalanceSummary {
  userId: string;
  displayName: string;
  netBalance: number;
  owes: Array<{
    toUserId: string;
    toDisplayName: string;
    amount: number;
  }>;
  owed: Array<{
    fromUserId: string;
    fromDisplayName: string;
    amount: number;
  }>;
}

export interface GroupBalanceSummary {
  groupId: string;
  currency: string;
  balances: UserBalanceSummary[];
  simplifiedDebts: Array<{
    fromUserId: string;
    toUserId: string;
    amount: number;
  }>;
}
