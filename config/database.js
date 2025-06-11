/**
 * 資料庫連接設定
 */
const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

/**
 * 連接到 MongoDB 資料庫
 * @returns {Promise} 連接結果的 Promise
 */
async function connectToDatabase() {
  try {
    if (!MONGO_URI) {
      throw new Error('環境變數中未設置 MONGO_URI');
    }

    console.log('正在連接到 MongoDB...');
    
    // 設定 Mongoose 連接選項
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('MongoDB 連接成功！');
    return true;
  } catch (error) {
    console.error('MongoDB 連接失敗:', error);
    return false;
  }
}

/**
 * 關閉資料庫連接
 */
async function closeDatabaseConnection() {
  try {
    await mongoose.connection.close();
    console.log('資料庫連接已關閉');
  } catch (error) {
    console.error('關閉資料庫連接時出錯:', error);
  }
}

/**
 * 監控資料庫連接狀態
 */
function monitorDatabaseConnection() {
  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB 連接中斷，嘗試重新連接...');
    setTimeout(connectToDatabase, 5000);
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB 連接錯誤:', err);
    mongoose.disconnect();
  });
}

module.exports = {
  connectToDatabase,
  closeDatabaseConnection,
  monitorDatabaseConnection
};
