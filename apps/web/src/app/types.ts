/**
 * types.ts
 *
 * WHAT: The shapes of what the API sends back. Keep in step with apps/api/src/routes.
 */

export type Member = {
  id: string;
  displayName: string;
  paymentMethod: string | null;
  isYou: boolean;
};

export type Group = {
  id: string;
  name: string;
  isOwner: boolean;
  seatLimit: number | null;
  members: Member[];
};

export type GroupSummary = { id: string; name: string };

export type PaymentStatus = "pending" | "confirmed" | "rejected" | "disputed";

export type Payment = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  status: PaymentStatus;
  reference: string;
  createdAt: string;
  hasProof: boolean;
  totalCentavos: number;
};
