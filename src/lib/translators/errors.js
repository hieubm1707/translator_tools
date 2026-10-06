// Engine trả về số phần tử khác số đoạn gửi đi (gộp/tách dòng) -> bên gọi chia nhỏ lô rồi thử lại.
export class BatchMismatchError extends Error {
  constructor() {
    super('Batch result count mismatch');
  }
}
