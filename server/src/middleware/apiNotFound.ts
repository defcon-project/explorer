import type { RequestHandler } from 'express';

/**
 * Keep the documentation SPA at `/api`, but never let an unknown API path
 * fall through to the SPA shell. A 200 HTML response makes client and ops
 * failures look successful even though no API route handled the request.
 */
export const rejectUnknownApiRequest: RequestHandler = (req, res, next) => {
  const isApiDocumentationPage =
    (req.method === 'GET' || req.method === 'HEAD') && (req.path === '/' || req.path === '');

  if (isApiDocumentationPage) {
    return next();
  }

  return res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'API endpoint not found',
    },
  });
};
