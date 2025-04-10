import { l2PublicClient, l2Chain } from "@/lib/chains";
import { fromViemBlock } from "@/lib/viem";
import { prisma, fromPrismaBlock } from "@/lib/prisma";

const fetchBlockDetailsFromDatabase = async (number: bigint) => {
  const block = await prisma.block.findUnique({
    where: { number_chainId: { number, chainId: l2Chain.id } },
    include: { transactions: { select: { hash: true } } },
  });
  return block ? fromPrismaBlock(block) : fetchBlockDetailsFromJsonRpc(number);
};

const fetchBlockDetailsFromJsonRpc = async (number: bigint) => {
  try {
    const block = await l2PublicClient.getBlock({ blockNumber: number });
    return fromViemBlock(block);
  } catch (error) {
    console.error(error);
    return null;
  }
};

const fetchBlockDetails = process.env.DATABASE_URL
  ? fetchBlockDetailsFromDatabase
  : fetchBlockDetailsFromJsonRpc;

export default fetchBlockDetails;
