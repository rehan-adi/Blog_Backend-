import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { client } from '../lib/redis.js';
import { Request, Response } from 'express';
import postModel from '../models/post.model.js';
import categoryModel from '../models/category.model.js';
import { uploadOnCloudinary } from '../utils/cloudinary.js';
import {
    createPostValidation,
    updatePostValidation
} from '../validations/post.validation.js';

const CACHE_KEY = 'posts:all';
const PROFILE_CACHE_KEY = (userId: string) => `profile:${userId}`;
const POSTS_CACHE_KEY = (userId: string) => `posts:${userId}`;

// create a new post
export const createPost = async (req: Request, res: Response) => {
    try {
        const author = req.user?.id;

        if (!author) {
            return res.status(401).json({
                success: false,
                message: 'You are not authenticated. Please Signin'
            });
        }

        // validate the request body using Zod
        const parsedData = createPostValidation.parse(req.body);
        const { content, tags, category } = parsedData;

        // Handle file upload if present
        const image = req.file ? req.file.path : null;

        // Check if the category already exists, if not, create it
        let categoryName = await categoryModel.findOne({ name: category });
        if (!categoryName) {
            categoryName = new categoryModel({ name: category });
            await categoryName.save();
        }

        let imageUrl = null;

        if (req.file) {
            try {
                const uploadedImage = await uploadOnCloudinary(req.file.path);
                imageUrl = uploadedImage ? uploadedImage.secure_url : null;
            } catch (uploadError) {
                return res.status(500).json({
                    success: false,
                    message: 'Image upload to Cloudinary failed',
                    error:
                        uploadError instanceof Error
                            ? uploadError.message
                            : 'Unknown error'
                });
            }
        } else {
            console.log('No file received'); // Log if no file is received
        }

        // Create a new post
        const newPost = await postModel.create({
            content,
            author,
            image: imageUrl,
            tags,
            category: categoryName._id
        });

        const populatedPost = await postModel
            .findById(newPost._id)
            .populate('author', 'username profilePicture fullname')
            .populate('category', 'name');

        const cachedPosts = await client.get(CACHE_KEY);
        if (cachedPosts) {
            const posts = JSON.parse(cachedPosts);
            posts.unshift(populatedPost); // Add new post at the beginning
            await client.set(CACHE_KEY, JSON.stringify(posts));
        }

        await client.del(PROFILE_CACHE_KEY(author));
        await client.del(POSTS_CACHE_KEY(author));

        // Respond with the created post details
        return res.status(201).json({
            success: true,
            data: {
                content: newPost.content,
                author: newPost.author,
                image: imageUrl,
                tags: newPost.tags,
                category: categoryName.name
            },
            message: 'Post created successfully'
        });
    } catch (error) {
        // Handle validation errors from Zod
        if (error instanceof ZodError) {
            return res.status(400).json({
                success: false,
                message: error.errors.map((e) => e.message)
            });
        }
        // Log the error and return a server error response
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create post',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// get all post
export const getAllPosts = async (req: Request, res: Response) => {
    const cacheTTL = 43200;

    try {
        const getDataFromCache = await client.get(CACHE_KEY);

        if (getDataFromCache) {
            return res.status(200).json({
                success: true,
                data: JSON.parse(getDataFromCache),
                message: 'All posts retrieved successfully'
            });
        }

        const allPosts = await postModel
            .find()
            .sort({ createdAt: -1 })
            .populate({
                path: 'author',
                select: 'username profilePicture fullname',
                model: 'User'
            })
            .populate('category', 'name');

        await client.set(CACHE_KEY, JSON.stringify(allPosts), {
            EX: cacheTTL
        });

        return res.status(200).json({
            success: true,
            data: allPosts,
            message: 'All posts retrieved successfully'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get all posts',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// get post by id
export const getPostsById = async (req: Request, res: Response) => {
    const postId = req.params.postId;

    try {
        const postExists = await postModel.findById(postId);

        if (!postExists) {
            return res.status(404).json({
                success: false,
                message: 'Post not found'
            });
        }

        const posts = await postModel
            .findById(postId)
            .populate('author', 'fullname');

        return res.status(200).json({
            success: true,
            data: {
                posts
            },
            message: 'Posts retrieved successfully'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get post details',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// get posts by category
export const getPostsByCategory = async (req: Request, res: Response) => {
    const categoryId = req.params.categoryId;

    try {
        const categoryExists = await categoryModel.findById(categoryId);

        if (!categoryExists) {
            return res.status(404).json({
                success: false,
                message: 'Post not found'
            });
        }

        const posts = await postModel
            .find({ category: categoryId })
            .populate('author', 'name')
            .populate('category', 'name');

        return res.status(200).json({
            success: true,
            data: {
                posts
            },
            message: 'Posts retrieved successfully'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get posts by category',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// update a post
export const updatePost = async (req: Request, res: Response) => {
    try {
        const postId = req.params.id;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'You are not authenticated. Please Signin'
            });
        }

        const parsedData = updatePostValidation.parse(req.body);

        const post = await postModel.findById(postId);
        if (!post) {
            return res.status(404).json({
                success: false,
                message: 'Failed to update: Post not found'
            });
        }

        if (post.author?.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to update this post'
            });
        }

        const updatedPost = await postModel.findByIdAndUpdate(
            postId,
            { $set: parsedData },
            { new: true }
        );

        if (!updatedPost) {
            return res.status(404).json({
                success: false,
                message: 'Failed to update: Post not found'
            });
        }

        const populatedUpdatedPost = await postModel
            .findById(updatedPost._id)
            .populate('author', 'username profilePicture fullname')
            .populate('category', 'name');

        const cachedPosts = await client.get(CACHE_KEY);
        if (cachedPosts) {
            const posts = JSON.parse(cachedPosts);
            const postIndex = posts.findIndex((p: any) => p._id === postId);
            if (postIndex > -1) {
                posts[postIndex] = populatedUpdatedPost;
                await client.set(CACHE_KEY, JSON.stringify(posts));
            }
        }

        await client.del(PROFILE_CACHE_KEY(userId));
        await client.del(POSTS_CACHE_KEY(userId));

        return res.status(200).json({
            success: true,
            data: {
                post: populatedUpdatedPost
            },
            message: 'Post updated successfully'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update post',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// delete a post
export const deletePost = async (req: Request, res: Response) => {
    try {
        const postId = req.params.id;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'You are not authenticated. Please Signin'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(postId)) {
            return res
                .status(400)
                .json({ success: false, message: 'Invalid post ID' });
        }

        const post = await postModel.findById(postId);
        if (!post) {
            return res.status(404).json({
                success: false,
                message: 'Failed to delete: Post not found'
            });
        }

        if (post.author?.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to delete this post'
            });
        }

        const deletePost = await postModel.findByIdAndDelete(postId);

        if (!deletePost) {
            return res.status(404).json({
                success: false,
                message: 'Failed to delete: Post not found'
            });
        }

        const cachedPosts = await client.get(CACHE_KEY);
        if (cachedPosts) {
            const posts = JSON.parse(cachedPosts);
            const filteredPosts = posts.filter((p: any) => p._id !== postId); // Remove the deleted post
            await client.set(CACHE_KEY, JSON.stringify(filteredPosts));
        }

        await client.del(PROFILE_CACHE_KEY(userId));
        await client.del(POSTS_CACHE_KEY(userId));

        return res.status(200).json({
            success: true,
            deletedPostId: postId,
            message: 'Post deleted successfully'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to delete post',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};
