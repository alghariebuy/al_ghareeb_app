import { db } from '@db';
import { users, messages, notifications } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import * as crypto from 'crypto';

// Hash password using SHA-256
export const hashPassword = (password: string): string => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// Compare password with stored hash
export const comparePassword = (password: string, hash: string): boolean => {
  return hashPassword(password) === hash;
};

// User management functions
export const storage = {
  // User functions
  async getUserByUsername(username: string) {
    return await db.query.users.findFirst({
      where: eq(users.username, username)
    });
  },

  async getUserById(id: number) {
    return await db.query.users.findFirst({
      where: eq(users.id, id)
    });
  },

  async getAllUsers() {
    return await db.query.users.findMany({
      orderBy: [desc(users.isOnline), desc(users.lastSeen)]
    });
  },

  async getAllHosts() {
    return await db.query.users.findMany({
      where: eq(users.role, 'host'),
      orderBy: [desc(users.isOnline), desc(users.lastSeen)]
    });
  },

  async createUser(userData: any) {
    try {
      const [user] = await db.insert(users)
        .values({
          ...userData,
          password: hashPassword(userData.password),
          lastSeen: new Date(),
          createdAt: new Date()
        })
        .returning();
      return user;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  },

  async updateUser(id: number, userData: any) {
    try {
      // If password is included, hash it
      if (userData.password) {
        userData.password = hashPassword(userData.password);
      }

      const [user] = await db.update(users)
        .set(userData)
        .where(eq(users.id, id))
        .returning();
      return user;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  },

  async deleteUser(id: number) {
    try {
      // Delete all messages related to the user
      await db.delete(messages)
        .where(
          or(
            eq(messages.senderId, id),
            eq(messages.receiverId, id)
          )
        );

      // Delete all notifications for the user
      await db.delete(notifications)
        .where(eq(notifications.userId, id));

      // Finally delete the user
      const [deletedUser] = await db.delete(users)
        .where(eq(users.id, id))
        .returning();
      return deletedUser;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  },

  async updateUserOnlineStatus(id: number, isOnline: boolean) {
    return await db.update(users)
      .set({
        isOnline,
        lastSeen: new Date()
      })
      .where(eq(users.id, id))
      .returning();
  },

  // Message functions
  async getMessages(userId1: number, userId2: number) {
    return await db.query.messages.findMany({
      where: or(
        and(
          eq(messages.senderId, userId1),
          eq(messages.receiverId, userId2)
        ),
        and(
          eq(messages.senderId, userId2),
          eq(messages.receiverId, userId1)
        )
      ),
      orderBy: messages.timestamp,
      with: {
        sender: true,
        receiver: true
      }
    });
  },

  async createMessage(messageData: any) {
    try {
      const [message] = await db.insert(messages)
        .values({
          ...messageData,
          timestamp: new Date(),
          isRead: false
        })
        .returning();
      return message;
    } catch (error) {
      console.error('Error creating message:', error);
      throw error;
    }
  },

  async markMessagesAsRead(senderId: number, receiverId: number) {
    return await db.update(messages)
      .set({ isRead: true })
      .where(
        and(
          eq(messages.senderId, senderId),
          eq(messages.receiverId, receiverId),
          eq(messages.isRead, false)
        )
      );
  },

  // Notification functions
  async getUserNotifications(userId: number) {
    return await db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
      orderBy: [desc(notifications.timestamp)]
    });
  },

  async createNotification(notificationData: any) {
    try {
      const [notification] = await db.insert(notifications)
        .values({
          ...notificationData,
          timestamp: new Date(),
          isRead: false
        })
        .returning();
      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  },

  async markNotificationAsRead(id: number) {
    return await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id));
  },

  // Broadcast and financial notifications
  async broadcastMessage(senderId: number, content: string, contentType: string = 'text', mediaUrl?: string, metadata?: any) {
    try {
      const hosts = await this.getAllHosts();
      
      const createdMessages = [];
      for (const host of hosts) {
        const message = await this.createMessage({
          senderId,
          receiverId: host.id,
          content,
          contentType,
          mediaUrl,
          metadata
        });
        createdMessages.push(message);
      }
      
      return createdMessages;
    } catch (error) {
      console.error('Error broadcasting message:', error);
      throw error;
    }
  },

  async sendFinancialNotification(
    senderId: number,
    recipientId: number | null,
    title: string,
    content: string,
    amount: number,
    mediaUrl?: string
  ) {
    try {
      const recipients = recipientId 
        ? [await this.getUserById(recipientId)].filter(Boolean)
        : await this.getAllHosts();
      
      const results = [];
      
      for (const recipient of recipients) {
        if (!recipient) continue;
        
        // Create notification
        const notification = await this.createNotification({
          userId: recipient.id,
          title,
          content,
          type: 'financial',
          metadata: { amount, mediaUrl }
        });
        
        // Also create a message
        const message = await this.createMessage({
          senderId,
          receiverId: recipient.id,
          content,
          contentType: 'financial',
          mediaUrl,
          metadata: { title, amount }
        });
        
        results.push({ notification, message });
      }
      
      return results;
    } catch (error) {
      console.error('Error sending financial notification:', error);
      throw error;
    }
  }
};

// Import missing or function
function or(...conditions: any[]) {
  return { type: 'or', conditions } as any;
}
