import mongoose, { Schema, Document } from 'mongoose';

export interface AddressDocument extends Document {
  address: string;
  balanceSat: mongoose.Types.Decimal128;
  totalReceivedSat: mongoose.Types.Decimal128;
  totalSentSat: mongoose.Types.Decimal128;
  txCount: number;
  firstSeen: number;
  lastSeen: number;
}

const addressSchema = new Schema<AddressDocument>(
  {
    address: { type: String, required: true, unique: true, index: true },
    balanceSat: { type: Schema.Types.Decimal128, default: '0', index: true },
    totalReceivedSat: { type: Schema.Types.Decimal128, default: '0' },
    totalSentSat: { type: Schema.Types.Decimal128, default: '0' },
    txCount: { type: Number, default: 0 },
    firstSeen: { type: Number, default: 0 },
    lastSeen: { type: Number, default: 0 },
  },
  { timestamps: true }
);

addressSchema.index({ balanceSat: -1 });
addressSchema.index({ firstSeen: -1 });

export const Address = mongoose.model<AddressDocument>('Address', addressSchema);
