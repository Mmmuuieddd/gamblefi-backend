/**
 * 清空遊戲事件資料庫
 */
const mongoose = require('mongoose');
require('dotenv').config();

// 連接到MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/stickman-nft', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('已連接到MongoDB'))
.catch(err => {
  console.error('MongoDB連接錯誤:', err);
  process.exit(1);
});

// 定義GameEvent模型
const GameEventSchema = new mongoose.Schema({}, { strict: false });
const GameEvent = mongoose.model('GameEvent', GameEventSchema);

async function clearDatabase() {
  try {
    // 刪除所有遊戲事件記錄
    const result = await GameEvent.deleteMany({});
    console.log(`已成功刪除 ${result.deletedCount} 條記錄`);
    
    // 查詢剩餘記錄數
    const count = await GameEvent.countDocuments();
    console.log(`資料庫中剩餘記錄數: ${count}`);
    
    mongoose.disconnect();
    console.log('已斷開資料庫連接');
  } catch (error) {
    console.error('刪除操作失敗:', error);
    mongoose.disconnect();
  }
}

// 執行清空操作
clearDatabase();
