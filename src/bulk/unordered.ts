import * as BSON from '../bson';
import { BulkOperationBase, Batch, BatchType, BulkWriteOptions } from './common';
import type { Callback } from '../utils';
import type { Document } from '../bson';
import type { Collection } from '../collection';

class UnorderedBulkOperation extends BulkOperationBase {
  constructor(collection: Collection, options: BulkWriteOptions) {
    super(collection, options, false);
  }

  handleWriteError(callback: Callback, writeResult: any): boolean | undefined {
    if (this.s.batches.length) {
      return false;
    }

    return super.handleWriteError(callback, writeResult);
  }

  addToOperationsList(batchType: BatchType, document: Document): UnorderedBulkOperation {
    // Get the bsonSize
    const bsonSize = BSON.calculateObjectSize(document, {
      checkKeys: false,

      // Since we don't know what the user selected for BSON options here,
      // err on the safe side, and check the size with ignoreUndefined: false.
      ignoreUndefined: false
    } as any);
    // Throw error if the doc is bigger than the max BSON size
    if (bsonSize >= this.s.maxBsonObjectSize) {
      throw new TypeError(`Document is larger than the maximum size ${this.s.maxBsonObjectSize}`);
    }

    // Holds the current batch
    this.s.currentBatch = undefined;
    // Get the right type of batch
    if (batchType === BatchType.INSERT) {
      this.s.currentBatch = this.s.currentInsertBatch;
    } else if (batchType === BatchType.UPDATE) {
      this.s.currentBatch = this.s.currentUpdateBatch;
    } else if (batchType === BatchType.REMOVE) {
      this.s.currentBatch = this.s.currentRemoveBatch;
    }

    const maxKeySize = this.s.maxKeySize;

    // Create a new batch object if we don't have a current one
    if (this.s.currentBatch == null) {
      this.s.currentBatch = new Batch(batchType, this.s.currentIndex);
    }

    // Check if we need to create a new batch
    if (
      // New batch if we exceed the max batch op size
      this.s.currentBatch.size + 1 >= this.s.maxWriteBatchSize ||
      // New batch if we exceed the maxBatchSizeBytes. Only matters if batch already has a doc,
      // since we can't sent an empty batch
      (this.s.currentBatch.size > 0 &&
        this.s.currentBatch.sizeBytes + maxKeySize + bsonSize >= this.s.maxBatchSizeBytes) ||
      // New batch if the new op does not have the same op type as the current batch
      this.s.currentBatch.batchType !== batchType
    ) {
      // Save the batch to the execution stack
      this.s.batches.push(this.s.currentBatch);

      // Create a new batch
      this.s.currentBatch = new Batch(batchType, this.s.currentIndex);
    }

    // We have an array of documents
    if (Array.isArray(document)) {
      throw new TypeError('Operation passed in cannot be an Array');
    }

    this.s.currentBatch.operations.push(document);
    this.s.currentBatch.originalIndexes.push(this.s.currentIndex);
    this.s.currentIndex = this.s.currentIndex + 1;

    // Save back the current Batch to the right type
    if (batchType === BatchType.INSERT) {
      this.s.currentInsertBatch = this.s.currentBatch;
      this.s.bulkResult.insertedIds.push({
        index: this.s.bulkResult.insertedIds.length,
        _id: document._id
      });
    } else if (batchType === BatchType.UPDATE) {
      this.s.currentUpdateBatch = this.s.currentBatch;
    } else if (batchType === BatchType.REMOVE) {
      this.s.currentRemoveBatch = this.s.currentBatch;
    }

    // Update current batch size
    this.s.currentBatch.size += 1;
    this.s.currentBatch.sizeBytes += maxKeySize + bsonSize;

    return this;
  }
}

export function initializeUnorderedBulkOp(collection: Collection, options: BulkWriteOptions) {
  return new UnorderedBulkOperation(collection, options);
}
