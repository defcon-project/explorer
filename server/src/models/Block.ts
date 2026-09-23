import mongoose, { Schema, Document } from 'mongoose';

export interface BlockDocument extends Document {
  hash: string;
  height: number;
  size: number;
  version: number;
  merkleroot: string;
  time: number;
  mediantime?: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork?: string;
  nTx: number;
  previousblockhash?: string;
  nextblockhash?: string;
  minedBy?: string;
  rewardSat: mongoose.Types.Decimal128;
  totalValueOutSat: mongoose.Types.Decimal128;
  txids: string[];
}

const blockSchema = new Schema<BlockDocument>(
  {
    hash: { type: String, required: true, unique: true, index: true },
    height: { type: Number, required: true, unique: true, index: true },
    size: { type: Number, required: true },
    version: { type: Number, required: true },
    merkleroot: { type: String, required: true },
    time: { type: Number, required: true, index: true },
    mediantime: { type: Number },
    nonce: { type: Number, required: true },
    bits: { type: String, required: true },
    difficulty: { type: Number, required: true },
    chainwork: { type: String },
    nTx: { type: Number, default: 0 },
    previousblockhash: { type: String },
    nextblockhash: { type: String },
    minedBy: { type: String, index: true },
    rewardSat: { type: Schema.Types.Decimal128, default: '0' },
    totalValueOutSat: { type: Schema.Types.Decimal128, default: '0' },
    txids: [{ type: String }],
  },
  { timestamps: true }
);

// Compound index for time-range queries with height sort (blocks list page)
blockSchema.index({ time: -1, height: -1 });

export const Block = mongoose.model<BlockDocument>('Block', blockSchema);
