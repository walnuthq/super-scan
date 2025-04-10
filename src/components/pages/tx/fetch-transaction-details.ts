import { type Hash } from "viem";
import { l2PublicClient } from "@/lib/chains";
import {
  type Erc20TransferWithToken,
  type TransactionWithReceiptAndAccounts,
} from "@/lib/types";
import { fromViemTransactionWithReceipt } from "@/lib/viem";
import { loadFunctions } from "@/lib/signatures";
import {
  prisma,
  fromPrismaTransactionWithReceiptAndAccounts,
  fromPrismaErc20TransferWithToken,
} from "@/lib/prisma";
import { parseErc20Transfers } from "@/lib/utils";
import getErc20Contract from "@/lib/contracts/erc-20/contract";
import { l2Chain } from "@/lib/chains";

type FetchTransactionDetailsReturnType = {
  transaction: TransactionWithReceiptAndAccounts | null;
  confirmations: bigint;
  erc20Transfers: Erc20TransferWithToken[];
};

const fetchTransactionDetailsFromDatabase = async (
  hash: Hash,
): Promise<FetchTransactionDetailsReturnType> => {
  try {
    const [transaction, confirmations] = await Promise.all([
      prisma.transaction.findUnique({
        where: { hash_chainId: { hash, chainId: l2Chain.id } },
        include: {
          receipt: {
            include: { erc20Transfers: { include: { token: true } } },
          },
          accounts: true,
        },
      }),
      l2PublicClient.getTransactionConfirmations({ hash }),
    ]);
    if (!transaction || !transaction.receipt) {
      return fetchTransactionDetailsFromJsonRpc(hash);
    }
    const signature = await loadFunctions(transaction.input.slice(0, 10));
    return {
      transaction: fromPrismaTransactionWithReceiptAndAccounts(
        transaction,
        signature,
      ),
      confirmations,
      erc20Transfers: transaction.receipt.erc20Transfers.map(
        fromPrismaErc20TransferWithToken,
      ),
    };
  } catch (error) {
    console.error(error);
    return { transaction: null, confirmations: BigInt(0), erc20Transfers: [] };
  }
};

const fetchTransactionDetailsFromJsonRpc = async (
  hash: Hash,
): Promise<FetchTransactionDetailsReturnType> => {
  try {
    const [transaction, transactionReceipt] = await Promise.all([
      l2PublicClient.getTransaction({ hash }),
      l2PublicClient.getTransactionReceipt({ hash }),
    ]);
    const [block, confirmations, erc20Transfers, signature] = await Promise.all(
      [
        l2PublicClient.getBlock({ blockNumber: transaction.blockNumber }),
        l2PublicClient.getTransactionConfirmations({ transactionReceipt }),
        parseErc20Transfers(transactionReceipt.logs),
        loadFunctions(transaction.input.slice(0, 10)),
      ],
    );
    const erc20TransfersWithToken = await Promise.all(
      erc20Transfers.map(async (erc20Transfer) => {
        const contract = getErc20Contract(erc20Transfer.address);
        const decimals = await contract.read.decimals();
        return {
          ...erc20Transfer,
          token: {
            address: erc20Transfer.address,
            name: "",
            symbol: "",
            decimals,
          },
        };
      }),
    );
    return {
      transaction: {
        ...fromViemTransactionWithReceipt(
          transaction,
          transactionReceipt,
          block.timestamp,
          signature,
        ),
        accounts: [],
      },
      confirmations,
      erc20Transfers: erc20TransfersWithToken,
    };
  } catch (error) {
    console.error(error);
    return { transaction: null, confirmations: BigInt(0), erc20Transfers: [] };
  }
};

const fetchTransactionDetails = process.env.DATABASE_URL
  ? fetchTransactionDetailsFromDatabase
  : fetchTransactionDetailsFromJsonRpc;

export default fetchTransactionDetails;
