import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import lessonRoutes from './routes/lessons.js';
import vocabularyRoutes from './routes/vocabulary.js';
import exerciseRoutes from './routes/exercises.js';

export function createApp() {
  const app = express();
  // Na Render a API fica atrás de um proxy: sem isto, o IP de todo mundo seria
  // o do proxy e todos os usuários dividiriam o mesmo limite de requisições.
  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json());

  app.get('/', (_req, res) =>
    res.json({ name: 'MandaRim API', status: 'ok', health: '/health' })
  );
  app.get('/health', (_req, res) =>
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      // Diagnóstico: mostra se a URL do Serviço de IA chegou ao backend.
      iaService: config.iaServiceUrl || null,
    })
  );

  // Limite por IP no resto da API (o health check da Render fica de fora).
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      message: { error: 'Muitas requisições. Tente de novo em instantes.' },
    })
  );

  app.use('/auth', authRoutes);
  app.use('/user', userRoutes);
  app.use('/lessons', lessonRoutes);
  app.use('/vocabulary', vocabularyRoutes);
  app.use('/', exerciseRoutes); // /exercise/generate, /flashcard/example

  // Pronúncia (TTS): proxia o áudio do Google para evitar bloqueio/consent
  // no navegador. O front toca <backend>/tts?text=...&lang=zh-CN diretamente.
  app.get('/tts', async (req, res) => {
    const text = String(req.query.text || '').slice(0, 200);
    const lang = String(req.query.lang || 'zh-CN');
    if (!text) return res.status(400).json({ error: 'Parâmetro "text" obrigatório' });
    const url =
      'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob' +
      `&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
    try {
      const upstream = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok) return res.status(502).json({ error: 'TTS indisponível' });
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.status(502).json({ error: 'TTS indisponível' });
    }
  });

  // 404
  app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

  // Tratador de erros
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  });

  return app;
}
