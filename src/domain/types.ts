export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

export interface Hotel {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface WorkflowResult {
  hotels: Hotel[];
  failedSuppliers: string[];
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  suppliers: {
    supplierA: 'up' | 'down';
    supplierB: 'up' | 'down';
  };
  redis: 'up' | 'down';
  temporal: 'up' | 'down';
  checkedAt: string;
}
