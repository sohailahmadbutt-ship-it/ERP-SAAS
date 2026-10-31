import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMoveType } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Tx } from '../prisma/prisma.service';
import { StockMoveInput } from './dto';

const D = Prisma.Decimal;

@Injectable()
export class StockService {
  /** Current quantity of a product in one warehouse. */
  async onHand(tx: Tx, productId: string, warehouseId: string) {
    const r = await tx.stockMove.aggregate({ where: { productId, warehouseId }, _sum: { quantity: true } });
    return r._sum.quantity ?? new D(0);
  }

  /**
   * Serialises stock changes per product and warehouse for the rest of the
   * transaction, so two deliveries at once can't both spend the same stock.
   */
  private async lock(tx: Tx, productId: string, warehouseId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${productId}:${warehouseId}`}, 0))`;
  }

  /** Records one stock operation. Must run inside a tenant transaction. */
  async apply(tx: Tx, tenantId: string, userId: string, dto: StockMoveInput) {
    const product = await tx.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.archived) throw new BadRequestException('Product not found');
    if (product.type !== 'GOODS') throw new BadRequestException('Services are not stocked');

    const warehouseIds = dto.kind === 'TRANSFER' ? [dto.warehouseId, dto.toWarehouseId!] : [dto.warehouseId];
    if (dto.kind === 'TRANSFER' && dto.warehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Pick two different warehouses');
    }
    const found = await tx.warehouse.findMany({ where: { id: { in: warehouseIds }, archived: false }, select: { id: true } });
    if (found.length !== warehouseIds.length) throw new BadRequestException('Warehouse not found');

    // Lock in a fixed order so concurrent transfers can't deadlock.
    for (const wh of [...warehouseIds].sort()) await this.lock(tx, product.id, wh);

    const base = {
      tenantId,
      productId: product.id,
      createdById: userId,
      reference: dto.reference,
      note: dto.note,
    };
    const move = (warehouseId: string, type: StockMoveType, quantity: Prisma.Decimal, extra: Partial<Prisma.StockMoveUncheckedCreateInput> = {}) =>
      tx.stockMove.create({ data: { ...base, warehouseId, type, quantity, ...extra } });

    const qty = new D(dto.quantity ?? 0);
    switch (dto.kind) {
      case 'RECEIPT':
        if (dto.unitCost !== undefined) await this.updateAverageCost(tx, product.id, qty, new D(dto.unitCost));
        return [await move(dto.warehouseId, 'RECEIPT', qty, { unitCost: dto.unitCost })];

      case 'DELIVERY': {
        await this.ensureAvailable(tx, product.id, dto.warehouseId, qty);
        return [await move(dto.warehouseId, 'DELIVERY', qty.neg())];
      }

      case 'TRANSFER': {
        await this.ensureAvailable(tx, product.id, dto.warehouseId, qty);
        const transferId = randomUUID();
        return [
          await move(dto.warehouseId, 'TRANSFER_OUT', qty.neg(), { transferId }),
          await move(dto.toWarehouseId!, 'TRANSFER_IN', qty, { transferId }),
        ];
      }

      case 'COUNT': {
        const diff = new D(dto.countedQuantity ?? 0).minus(await this.onHand(tx, product.id, dto.warehouseId));
        if (diff.isZero()) return [];
        return [await move(dto.warehouseId, 'ADJUSTMENT', diff)];
      }
    }
  }

  /**
   * Weighted average cost across all warehouses:
   * (on hand × current cost + received × unit cost) / (on hand + received).
   * With nothing (or less than nothing) on hand, the new unit cost is used.
   */
  private async updateAverageCost(tx: Tx, productId: string, qty: Prisma.Decimal, unitCost: Prisma.Decimal) {
    await tx.$executeRaw`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { cost: true } });
    const onHand = (await tx.stockMove.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? new D(0);
    const cost = onHand.lte(0)
      ? unitCost
      : onHand.times(product.cost).plus(qty.times(unitCost)).div(onHand.plus(qty));
    await tx.product.update({ where: { id: productId }, data: { cost: cost.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) } });
  }

  private async ensureAvailable(tx: Tx, productId: string, warehouseId: string, qty: Prisma.Decimal) {
    const available = await this.onHand(tx, productId, warehouseId);
    if (available.lessThan(qty)) {
      throw new BadRequestException(`Only ${available.toString()} in stock in that warehouse`);
    }
  }
}
