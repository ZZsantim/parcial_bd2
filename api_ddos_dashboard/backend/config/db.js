import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
const collectionName = process.env.DB_COLLECTION?.trim() || 'flujos_limpia';

if (!uri) {
  throw new Error('Falta configurar MONGO_URI en backend/.env');
}

if (!dbName) {
  throw new Error('Falta configurar DB_NAME en backend/.env');
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
let db = null;

export const connectDB = async () => {
  try {
    await client.connect();
    const connectedDb = client.db(dbName);
    await connectedDb.command({ ping: 1 });

    const collections = connectedDb.listCollections(
      { name: collectionName },
      { nameOnly: true },
    );
    if (!(await collections.hasNext())) {
      throw new Error(`La colección configurada "${collectionName}" no existe en "${dbName}"`);
    }

    db = connectedDb;
    console.log(`[DB] Conexión exitosa a MongoDB (${dbName}.${collectionName})`);
    return db;
  } catch (error) {
    db = null;
    console.error('[DB] No se pudo validar la conexión con MongoDB:', error.message);
    throw error;
  }
};

export const getDB = () => {
  if (!db) {
    throw new Error('MongoDB no está conectado');
  }
  return db;
};

export const flowsCollectionName = collectionName;

export const getFlowsCollection = () => getDB().collection(collectionName);

export const closeDB = () => client.close();