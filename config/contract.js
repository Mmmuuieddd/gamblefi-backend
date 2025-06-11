// 智能合約配置
require('dotenv').config();

// 從環境變量中獲取配置
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RPC_URL = process.env.RPC_URL;
const RPC_WSS_URL = process.env.RPC_WSS_URL;
const SETTLER_PRIVATE_KEY = process.env.SETTLER_PRIVATE_KEY;

// 引入合約 ABI
const CONTRACT_ABI = [
  // 添加新增的函數
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "_bankerFeePercent",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "_playerWinFeePercent",
        "type": "uint8"
      }
    ],
    "name": "setFeePercent",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdrawPlatformEarnings",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_revealDelay",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_maxCommitAge",
        "type": "uint256"
      }
    ],
    "name": "setBlockParams",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // FeeUpdated 事件
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "bankerFee",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "playerFee",
        "type": "uint8"
      }
    ],
    "name": "FeeUpdated",
    "type": "event"
  },
  // BetPlaced 事件
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint32",
        "name": "roomId",
        "type": "uint32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "player",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "betBig",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "commitBlock",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "revealBlockNumber",
        "type": "uint256"
      }
    ],
    "name": "BetPlaced",
    "type": "event"
  },
  // BetSettled 事件
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint32",
        "name": "roomId",
        "type": "uint32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "player",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "won",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "hashValue",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "blockHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "betId",
        "type": "uint256"
      }
    ],
    "name": "BetSettled",
    "type": "event"
  },
  // settleBet 方法
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "_roomId",
        "type": "uint32"
      },
      {
        "internalType": "address",
        "name": "_player",
        "type": "address"
      }
    ],
    "name": "settleBet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // playerBets 映射查詢方法
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "playerBets",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "betId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "betBig",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "processed",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "commitBlock",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

module.exports = {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  RPC_URL,
  RPC_WSS_URL,
  SETTLER_PRIVATE_KEY
};
