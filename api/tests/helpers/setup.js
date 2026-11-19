import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Partner } from '../../src/models/Partner.js';
import { createApiKey } from '../../src/services/apiKey.service.js';

// Uses TEST_MONGODB_URI if set (e.g. a local mongod); otherwise downloads/starts mongodb-memory-server.
export async function startTestEnv() {
  let mongod;
  const uri = process.env.TEST_MONGODB_URI || (mongod = await MongoMemoryServer.create()).getUri();
  // Only for MongoDB-compatible servers without partial-index support (e.g. FerretDB 1.x). Real MongoDB never needs this.
  // The app also enforces "one active record per phone" in code, so tests still exercise that rule.
  if (process.env.TEST_DB_COMPAT === 'no-partial-indexes') {
    mongoose.set('autoIndex', false);
    for (const m of Object.values(mongoose.models)) m.schema._indexes = m.schema._indexes.filter(([, o]) => !o?.partialFilterExpression);
  }
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  return { app: createApp(), uri, stop: async () => { await mongoose.disconnect(); if (mongod) await mongod.stop(); } };
}

export const PASSWORD = 'correct-horse-battery';

export async function makeUser(role, email, partnerId) {
  return User.create({ email, name: email, role, partnerId, passwordHash: await bcrypt.hash(PASSWORD, 4) });
}
export async function login(app, email) {
  const r = await request(app).post('/v1/auth/login').send({ email, password: PASSWORD });
  return r.body.token;
}
export async function makePartnerKey(over = {}) {
  const partner = await Partner.create({ organization: 'Test Programme', plan: 'growth' });
  const { fullKey, doc } = await createApiKey({ partnerId: partner._id, name: 'k', mode: 'test', plan: 'growth', ...over });
  return { partner, fullKey, keyDoc: doc };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
