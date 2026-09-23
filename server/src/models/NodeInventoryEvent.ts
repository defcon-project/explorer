import { Schema, model, type InferSchemaType } from 'mongoose';

const nodeInventoryEventSchema = new Schema(
  {
    nodeKey: { type: String, required: true, index: true },
    ip: { type: String, required: true, index: true },
    port: { type: Number, required: true },
    eventType: {
      type: String,
      enum: ['discovered', 'version_changed', 'chain_changed'],
      required: true,
      index: true,
    },
    previousVersion: { type: String, default: null },
    walletVersion: { type: String, default: null },
    previousChainStatus: { type: String, default: null },
    chainStatus: { type: String, default: null },
    blockHeight: { type: Number, default: null },
    bestBlockHash: { type: String, default: null },
    sources: { type: [String], default: [] },
  },
  { timestamps: true }
);

nodeInventoryEventSchema.index({ nodeKey: 1, createdAt: -1 });
nodeInventoryEventSchema.index({ eventType: 1, createdAt: -1 });

export type NodeInventoryEventDocument = InferSchemaType<typeof nodeInventoryEventSchema>;

export const NodeInventoryEvent = model<NodeInventoryEventDocument>(
  'NodeInventoryEvent',
  nodeInventoryEventSchema
);
