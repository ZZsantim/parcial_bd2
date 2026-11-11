import { consultarEnLenguajeNatural } from '../services/consultaService.js';

export const consultar = async (req, res) => {
  const question = req.body?.question;
  if (typeof question !== 'string' || question.trim().length < 3 || question.trim().length > 500) {
    return res.status(400).json({
      message: 'La pregunta debe tener entre 3 y 500 caracteres.',
    });
  }

  try {
    const result = await consultarEnLenguajeNatural(question.trim());
    res.status(200).json(result);
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (status >= 500) {
      console.error('[API] Error en consulta de lenguaje natural:', error.message);
    }
    res.status(status).json({
      message: error.message || 'No se pudo procesar la consulta.',
      ...(status === 504 && error.pipeline ? { pipeline: error.pipeline } : {}),
    });
  }
};

export default { consultar };
