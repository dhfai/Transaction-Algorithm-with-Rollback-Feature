import express from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

const transferWithRetry = async (senderAccount: string, receiverAccount: string, amount: number, retries: number = 5) => {
  let attempt = 0;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  while (attempt < retries) {
    try {
      await prisma.$transaction(async (prisma) => {
        const sender = await prisma.nasabah.findUnique({ where: { norekening: senderAccount } });
        const receiver = await prisma.nasabah.findUnique({ where: { norekening: receiverAccount } });

        if (!sender) {
          throw new Error('Sender account not found');
        }
        if (!receiver) {
          throw new Error('Receiver account not found');
        }
        if (sender.saldo < amount) {
          throw new Error('Insufficient balance');
        }

        await prisma.nasabah.update({
          where: { norekening: senderAccount },
          data: { saldo: sender.saldo - amount },
        });

        await prisma.nasabah.update({
          where: { norekening: receiverAccount },
          data: { saldo: receiver.saldo + amount },
        });
      });

      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.message === 'Insufficient balance') {
        throw error;
      }

      console.error(`Transaction attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : error}`);
      attempt += 1;
      await delay(2 ** attempt * 100);
    }
  }

  throw new Error('Transaction failed after maximum retries');
};

app.post('/transfer', async (req, res) => {
  const { senderAccount, receiverAccount, amount, password } = req.body;

  try {
    const sender = await prisma.nasabah.findUnique({ where: { norekening: senderAccount } });

    if (!sender || sender.password !== password) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await transferWithRetry(senderAccount, receiverAccount, amount);

    res.status(200).json({ message: 'Transfer successful' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Insufficient balance') {
      return res.status(400).json({ error: 'Transaction failed due to insufficient balance', rollback: true });
    }
    res.status(500).json({ error: 'Transaction failed' });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
