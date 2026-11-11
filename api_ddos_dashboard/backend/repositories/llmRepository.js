import { getFlowsCollection } from '../config/db.js';
import { NOMBRES_CAMPOS_FLUJO } from './esquemaFlujos.js';

const RESULT_LIMIT = 100;
// Tope de ejecución de la consulta generada sobre la colección completa.
const QUERY_MAX_TIME_MS = Number(process.env.CONSULTA_MAX_TIME_MS || 120_000);
const MAX_STAGES = 8;

const sourceFields = new Set(NOMBRES_CAMPOS_FLUJO);

const allowedStages = new Set([
  '$match',
  '$group',
  '$project',
  '$sort',
  '$limit',
  '$count',
]);

const allowedExpressionOperators = new Set([
  '$abs',
  '$add',
  '$concat',
  '$addToSet',
  '$and',
  '$avg',
  '$ceil',
  '$cond',
  '$dateToString',
  '$divide',
  '$eq',
  '$first',
  '$floor',
  '$gt',
  '$gte',
  '$ifNull',
  '$in',
  '$last',
  '$literal',
  '$lt',
  '$lte',
  '$max',
  '$min',
  '$multiply',
  '$ne',
  '$not',
  '$or',
  '$push',
  '$round',
  '$size',
  '$sortArray',
  '$substrBytes',
  '$subtract',
  '$sum',
  '$toInt',
  '$toLower',
  '$toString',
]);

const assertSourceField = (path, allowedFields = sourceFields) => {
  const root = path.split('.')[0];
  if (!allowedFields.has(root)) {
    throw new Error(`Campo no permitido en la consulta: ${root}`);
  }
};

const validateExpression = (value, allowedFields, depth = 0) => {
  if (depth > 20) {
    throw new Error('La consulta generada supera la profundidad permitida.');
  }

  if (typeof value === 'string') {
    if (value.startsWith('$$')) {
      throw new Error('No se permiten variables internas en la consulta.');
    }
    if (value.startsWith('$')) {
      assertSourceField(value.slice(1), allowedFields);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => validateExpression(item, allowedFields, depth + 1));
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key.startsWith('$') && !allowedExpressionOperators.has(key)) {
      throw new Error(`Operador de consulta no permitido: ${key}`);
    }
    validateExpression(nestedValue, allowedFields, depth + 1);
  }
};

const validateMatch = (match, allowedFields, depth = 0) => {
  if (depth > 10 || !match || typeof match !== 'object' || Array.isArray(match)) {
    throw new Error('La etapa $match no tiene un formato permitido.');
  }

  for (const [field, condition] of Object.entries(match)) {
    if (field === '$and' || field === '$or') {
      if (!Array.isArray(condition) || condition.length === 0 || condition.length > 10) {
        throw new Error(`La condición ${field} debe tener entre 1 y 10 elementos.`);
      }
      condition.forEach((item) => validateMatch(item, allowedFields, depth + 1));
      continue;
    }

    if (field.startsWith('$')) {
      throw new Error(`Operador de filtro no permitido: ${field}`);
    }

    assertSourceField(field, allowedFields);

    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      for (const [operator, operand] of Object.entries(condition)) {
        if (!['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists'].includes(operator)) {
          throw new Error(`Operador de filtro no permitido: ${operator}`);
        }
        if (['$in', '$nin'].includes(operator) && (!Array.isArray(operand) || operand.length > 100)) {
          throw new Error(`${operator} requiere una lista de máximo 100 valores.`);
        }
      }
    }
  }
};

export const validarPipeline = (pipeline) => {
  try {
    if (!Array.isArray(pipeline) || pipeline.length < 1 || pipeline.length > MAX_STAGES) {
      throw new Error(`La consulta debe tener entre 1 y ${MAX_STAGES} etapas.`);
    }

    const allowedFields = new Set(sourceFields);
    for (const stage of pipeline) {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
        throw new Error('Cada etapa de la consulta debe ser un objeto.');
      }

      const [operator, value] = Object.entries(stage)[0] ?? [];
      if (Object.keys(stage).length !== 1 || !allowedStages.has(operator)) {
        throw new Error(`Etapa de agregación no permitida: ${operator ?? 'vacía'}`);
      }

      if (operator === '$limit') {
        if (!Number.isInteger(value) || value < 1 || value > RESULT_LIMIT) {
          throw new Error(`$limit debe ser un entero entre 1 y ${RESULT_LIMIT}.`);
        }
        continue;
      }

      if (operator === '$match') {
        validateMatch(value, allowedFields);
        continue;
      }

      if (operator === '$sort') {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length < 1 || Object.keys(value).length > 5) {
          throw new Error('$sort debe contener entre 1 y 5 campos.');
        }
        for (const [field, direction] of Object.entries(value)) {
          assertSourceField(field, allowedFields);
          if (direction !== 1 && direction !== -1) {
            throw new Error('$sort solo acepta direcciones 1 o -1.');
          }
        }
        continue;
      }

      if (operator === '$count') {
        if (typeof value !== 'string' || value.length < 1 || value.length > 60 || value.startsWith('$')) {
          throw new Error('$count debe usar un nombre de campo válido.');
        }
        continue;
      }

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${operator} debe contener un objeto.`);
      }
      validateExpression(value, allowedFields);

      if (operator === '$group') {
        if (!Object.hasOwn(value, '_id')) {
          throw new Error('$group debe incluir el campo _id.');
        }
        allowedFields.clear();
        allowedFields.add('_id');
        Object.keys(value).forEach((field) => allowedFields.add(field));
      } else if (operator === '$project') {
        const projectedFields = new Set();
        for (const [field, expression] of Object.entries(value)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,59}$/.test(field)) {
            throw new Error(`Nombre de campo proyectado no permitido: ${field}`);
          }
          if (expression !== 0 && expression !== false) projectedFields.add(field);
        }
        if (!Object.hasOwn(value, '_id') || (value._id !== 0 && value._id !== false)) {
          projectedFields.add('_id');
        }
        allowedFields.clear();
        projectedFields.forEach((field) => allowedFields.add(field));
      }
    }

    return pipeline;
  } catch (error) {
    error.statusCode = 422;
    throw error;
  }
};

export const ejecutarConsultaGenerada = async (pipeline) => {
  const validatedPipeline = validarPipeline(pipeline);
  try {
    return await getFlowsCollection()
      .aggregate(
        [...validatedPipeline, { $limit: RESULT_LIMIT }],
        { maxTimeMS: QUERY_MAX_TIME_MS, allowDiskUse: true },
      )
      .toArray();
  } catch (error) {
    if (error.code === 50 || error.codeName === 'MaxTimeMSExpired') {
      throw Object.assign(
        new Error(`La consulta superó el tiempo máximo de ${QUERY_MAX_TIME_MS} ms sobre la colección completa. Agrega un filtro (por ejemplo por Label, Source IP, Protocol o Timestamp) y vuelve a intentar.`),
        { statusCode: 504 },
      );
    }
    throw error;
  }
};

export default { ejecutarConsultaGenerada, validarPipeline };
