'use client';
import { useEffect, useState } from 'react';
import { api, Contact, Page, Product, Tax, Warehouse } from './api';

/** Pick-lists a sales document form needs. */
export function useSalesData() {
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  useEffect(() => {
    api<Page<Contact>>('/contacts?pageSize=200').then((p) => setCustomers(p.items)).catch(() => {});
    api<Page<Product>>('/products?pageSize=200').then((p) => setProducts(p.items)).catch(() => {});
    api<Tax[]>('/taxes').then(setTaxes).catch(() => {});
    api<Warehouse[]>('/warehouses').then((w) => setWarehouses(w.filter((x) => !x.archived))).catch(() => {});
  }, []);
  return { customers, products, taxes, warehouses };
}
