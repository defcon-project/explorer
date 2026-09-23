import { Schema, model, type InferSchemaType } from 'mongoose';

const providerTagSchema = new Schema(
  {
    cidr: { type: String, required: true, trim: true },
    provider: { type: String, required: true, trim: true, maxlength: 80 },
    source: {
      type: String,
      enum: ['operator_reported', 'manual', 'asn', 'rdns'],
      default: 'manual',
    },
    confidence: { type: Number, min: 0, max: 100, default: 85 },
    reporter: { type: String, trim: true, default: null },
    evidenceUrl: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
    active: { type: Boolean, default: true },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
  },
  { timestamps: true }
);

providerTagSchema.index({ cidr: 1, provider: 1 }, { unique: true });
providerTagSchema.index({ active: 1, validFrom: 1, validTo: 1 });
providerTagSchema.index({ source: 1, provider: 1 });

export type ProviderTagDocument = InferSchemaType<typeof providerTagSchema>;

export const ProviderTag = model<ProviderTagDocument>('ProviderTag', providerTagSchema);

