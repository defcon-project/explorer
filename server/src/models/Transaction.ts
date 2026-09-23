import mongoose, { Schema, Document } from 'mongoose';

export interface TransactionDocument extends Document {
  txid: string;
  blockhash: string;
  blockheight: number;
  blocktime: number;
  involvedAddresses?: string[];
  version?: number;
  size?: number;
  locktime?: number;
  vin: Array<{
    txid?: string;
    vout?: number;
    scriptSig?: { asm?: string; hex?: string };
    coinbase?: string;
    sequence?: number;
    valueSat?: mongoose.Types.Decimal128;
    address?: string;
  }>;
  vout: Array<{
    valueSat?: mongoose.Types.Decimal128;
    n?: number;
    scriptPubKey?: {
      asm?: string;
      hex?: string;
      reqSigs?: number;
      type?: string;
      addresses?: string[];
    };
  }>;
  totalValueInSat: mongoose.Types.Decimal128;
  totalValueOutSat: mongoose.Types.Decimal128;
  feeSat: mongoose.Types.Decimal128;
  isCoinbase: boolean;
  addressUpdatesApplied?: boolean;
}

const scriptSigSchema = new Schema(
  {
    asm: String,
    hex: String,
  },
  { _id: false }
);

// Important: `type` is a reserved key in Mongoose schema definitions, so it must be
// defined as `{ type: String }` to represent a field actually named "type".
const scriptPubKeySchema = new Schema(
  {
    asm: String,
    hex: String,
    reqSigs: Number,
    type: { type: String },
    addresses: [String],
  },
  { _id: false }
);

const vinSchema = new Schema(
  {
    txid: String,
    vout: Number,
    scriptSig: scriptSigSchema,
    coinbase: String,
    sequence: Number,
    valueSat: Schema.Types.Decimal128,
    address: String,
  },
  { _id: false }
);

const voutSchema = new Schema(
  {
    valueSat: Schema.Types.Decimal128,
    n: Number,
    scriptPubKey: scriptPubKeySchema,
  },
  { _id: false }
);

const transactionSchema = new Schema<TransactionDocument>(
  {
    txid: { type: String, required: true, unique: true, index: true },
    blockhash: { type: String, required: true, index: true },
    blockheight: { type: Number, required: true, index: true },
    blocktime: { type: Number, required: true },
    involvedAddresses: [{ type: String }],
    version: { type: Number },
    size: { type: Number },
    locktime: { type: Number },
    vin: [vinSchema],
    vout: [voutSchema],
    totalValueInSat: { type: Schema.Types.Decimal128, default: '0' },
    totalValueOutSat: { type: Schema.Types.Decimal128, default: '0' },
    feeSat: { type: Schema.Types.Decimal128, default: '0' },
    isCoinbase: { type: Boolean, default: false },
    addressUpdatesApplied: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

transactionSchema.index({ blockheight: -1, _id: -1 });
transactionSchema.index({ blocktime: -1 });
transactionSchema.index({ 'vin.address': 1, blockheight: -1 });
transactionSchema.index({ 'vout.scriptPubKey.addresses': 1, blockheight: -1 });
transactionSchema.index({ involvedAddresses: 1, blockheight: -1, _id: -1 });
// Coinbase + address lookup for v1 address rewards aggregation
transactionSchema.index({ isCoinbase: 1, 'vout.scriptPubKey.addresses': 1 });

export const Transaction = mongoose.model<TransactionDocument>('Transaction', transactionSchema);
