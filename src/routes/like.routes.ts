import express from 'express';
import { like } from '../controllers/like.js';
import { checkLogin } from '../middlewares/auth.middleware.js';

const likeRouter = express.Router();

likeRouter.post('/:postId/toggle-like', checkLogin, like)

export default likeRouter;
