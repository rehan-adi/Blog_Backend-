import { z } from 'zod';
import { Request, Response } from 'express';
import userModel from '../models/user.model.js';
import postModel from '../models/post.model.js';
import commentModel from '../models/comment.model.js';
import { commentValidation } from '../validations/comment.validation.js';

export const createComment = async (req: Request, res: Response) => {
    try {
        const { postId } = req.params;
        const authorId = req.user?.id;

        const parseData = commentValidation.parse(req.body);
        const { content } = parseData;

        const post = await postModel.findById(postId);
        const user = await userModel.findById(authorId);

        if (!post || !user) {
            return res.status(404).json({
                success: false,
                message: 'Post or user not found'
            });
        }

        const comment = await commentModel.create({
            post: postId,
            author: authorId,
            content
        });

        return res.status(201).json({
            success: true,
            comment: {
                id: comment._id,
                post: comment.post,
                author: comment.author,
                content: comment.content
            },
            message: 'Comment created'
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: error.errors
            });
        }
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to add comment',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const getComments = async (req: Request, res: Response) => {
    const { postId } = req.params;

    const post = await postModel.findById(postId);

    if (!post) {
        return res
            .status(404)
            .json({ success: false, message: 'Post not found' });
    }

    try {
        const comment = await commentModel
            .find({ post: postId })
            .populate('author', 'fullname profilePicture');
        const totalComments = await commentModel.countDocuments({
            post: postId
        });

        return res.status(200).json({
            success: true,
            comments: comment,
            totalComments
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get comment',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const updateComment = async (req: Request, res: Response) => {
    try {
        const commentId = req.params.commentId;
        const userId = req.user?.id;
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({
                success: false,
                message: 'Content is required'
            });
        }

        const comment = await commentModel.findById(commentId);

        if (!comment) {
            return res
                .status(404)
                .json({ success: false, message: 'Comment not found' });
        }

        if (comment.author.toString() != userId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to update this comment'
            });
        }

        const updatedComment = await commentModel.findByIdAndUpdate(
            commentId,
            { content },
            {
                new: true
            }
        );

        if (!updatedComment) {
            return res.status(404).json({
                success: false,
                message: 'Comment not found'
            });
        }

        return res.status(200).json({
            success: true,
            comment: {
                id: updatedComment._id,
                post: updatedComment.post,
                author: updatedComment.author,
                content: updatedComment.content
            },
            message: 'Comment updated'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update comment',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const deleteComments = async (req: Request, res: Response) => {
    try {
        const commentId = req.params.commentId;
        const userId = req.user?.id;

        const comment = await commentModel.findById(commentId);
        if (!comment) {
            return res
                .status(404)
                .json({ success: false, message: 'Comment not found' });
        }

        if (comment.author.toString() != userId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to delete this comment'
            });
        }

        const deletedComment = await commentModel.findByIdAndDelete(commentId);

        if (!deletedComment) {
            return res
                .status(404)
                .send({ success: false, message: 'Comment not found' });
        }

        return res.status(200).json({
            success: true,
            comment: {
                id: deletedComment._id,
                post: deletedComment.post,
                author: deletedComment.author,
                content: deletedComment.content
            },
            message: 'Comment deleted'
        });
    } catch (error) {
        console.error(
            `Failed to delete comment with id ${req.params.id}:`,
            error
        );
        return res.status(500).json({
            success: false,
            message: 'Failed to delete comment',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};
