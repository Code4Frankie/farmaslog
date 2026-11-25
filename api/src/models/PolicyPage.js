import mongoose from 'mongoose';

// Website pages an administrator edits (privacy notice, terms). One document per page. `draft` is what is being edited;
// `published` is what the public sees; every published version is kept in `history`.
const sectionSchema = new mongoose.Schema({ heading: String, body: String }, { _id: false });
const versionSchema = new mongoose.Schema(
  { version: Number, title: String, sections: [sectionSchema], publishedAt: Date, publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } },
  { _id: false },
);
const policyPageSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, enum: ['privacy', 'terms'] },
    draft: { title: String, sections: [sectionSchema], updatedAt: Date, updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } },
    published: versionSchema,
    history: [versionSchema],
  },
  { timestamps: true },
);
export const PolicyPage = mongoose.model('PolicyPage', policyPageSchema);
