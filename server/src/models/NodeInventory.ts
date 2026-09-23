import { Schema, model, type InferSchemaType } from 'mongoose';

const nodeInventorySchema = new Schema(
  {
    nodeKey: { type: String, required: true, trim: true, unique: true, index: true },
    ip: { type: String, required: true, trim: true, index: true },
    port: { type: Number, required: true, min: 1, max: 65535 },
    sources: { type: [String], default: [] },
    labels: { type: [String], default: [] },
    walletVersion: { type: String, default: null, index: true },
    // Kept independently from lastObservedAt: RPC masternode snapshots do not
    // expose a daemon version and must not erase a version seen from a peer.
    lastVersionObservedAt: { type: Date, default: null, index: true },
    protocolVersion: { type: Number, default: null },
    blockHeight: { type: Number, default: null },
    bestBlockHash: { type: String, default: null },
    connections: { type: Number, default: null },
    syncProgress: { type: Number, default: null },
    nodeStatus: { type: String, default: null },
    chainStatus: {
      type: String,
      enum: ['main_chain', 'ahead', 'behind', 'hash_mismatch', 'unknown'],
      default: 'unknown',
      index: true,
    },
    blocksDelta: { type: Number, default: null },
    masternodeProTxHash: { type: String, default: null, index: true },
    masternodeStatus: { type: String, default: null },
    firstSeenAt: { type: Date, required: true, default: () => new Date() },
    lastSeenAt: { type: Date, default: null },
    lastObservedAt: { type: Date, required: true, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

nodeInventorySchema.index({ walletVersion: 1, chainStatus: 1 });
nodeInventorySchema.index({ sources: 1, lastObservedAt: -1 });
nodeInventorySchema.index({ lastSeenAt: -1, walletVersion: 1 });
nodeInventorySchema.index({ ip: 1, port: 1 }, { unique: true });

export type NodeInventoryDocument = InferSchemaType<typeof nodeInventorySchema>;

export const NodeInventory = model<NodeInventoryDocument>('NodeInventory', nodeInventorySchema);
