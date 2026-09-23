import { Schema, model, type InferSchemaType } from 'mongoose';

const providerTagSubmissionSchema = new Schema(
  {
    cidr: { type: String, required: true, trim: true },
    provider: { type: String, required: true, trim: true, maxlength: 80 },
    source: {
      type: String,
      enum: ['operator_reported', 'manual', 'asn', 'rdns'],
      default: 'operator_reported',
    },
    confidence: { type: Number, min: 0, max: 100, default: 85 },
    submittedBy: { type: String, trim: true, default: null },
    reporter: { type: String, trim: true, default: null },
    contact: { type: String, trim: true, default: null },
    evidenceUrl: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewNote: { type: String, trim: true, default: null },
    reviewer: { type: String, trim: true, default: null },
    reviewedAt: { type: Date, default: null },
    resolvedTagId: { type: Schema.Types.ObjectId, ref: 'ProviderTag', default: null },
  },
  { timestamps: true }
);

providerTagSubmissionSchema.index({ status: 1, createdAt: -1 });
providerTagSubmissionSchema.index({ cidr: 1, provider: 1, status: 1 });

export type ProviderTagSubmissionDocument = InferSchemaType<typeof providerTagSubmissionSchema>;

export const ProviderTagSubmission = model<ProviderTagSubmissionDocument>(
  'ProviderTagSubmission',
  providerTagSubmissionSchema
);
