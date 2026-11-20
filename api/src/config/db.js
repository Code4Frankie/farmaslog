import dns from 'node:dns';
import mongoose from 'mongoose';

// Local-only DNS workaround so mongodb+srv:// lookups work on restrictive networks
if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

export async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}
export const disconnectDb = () => mongoose.disconnect();