export interface ApiResponse<T> {
  success: boolean;
  data: T;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export interface SearchResult {
  type: 'block' | 'transaction' | 'address';
  query: string;
  result: unknown;
}
