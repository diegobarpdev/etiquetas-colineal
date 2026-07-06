import { prisma } from '../lib/prisma';
import { OrderWithLines, ProductWithBom } from '../types';

const productInclude = {
  labelTemplate: true,
  boms: {
    include: {
      lines: {
        include: {
          componentProduct: {
            include: {
              labelTemplate: true,
              boms: {
                include: {
                  lines: {
                    include: {
                      componentProduct: {
                        include: {
                          labelTemplate: true,
                          boms: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export async function listOrders() {
  return prisma.manufacturingOrder.findMany({
    orderBy: { name: 'desc' },
    take: 100,
    select: {
      id: true,
      name: true,
      lotNumber: true,
      productionDate: true,
      state: true,
    },
  });
}

export async function searchOrders(query: string) {
  return prisma.manufacturingOrder.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { lotNumber: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { name: 'desc' },
    take: 20,
    select: {
      id: true,
      name: true,
      lotNumber: true,
      productionDate: true,
      state: true,
    },
  });
}

export async function getOrderById(id: number): Promise<OrderWithLines | null> {
  const order = await prisma.manufacturingOrder.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          product: {
            include: productInclude,
          },
        },
      },
    },
  });

  if (!order) return null;

  return order as unknown as OrderWithLines;
}

export async function listTemplates() {
  return prisma.labelTemplate.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
    },
    orderBy: { name: 'asc' },
  });
}

export type { ProductWithBom };
