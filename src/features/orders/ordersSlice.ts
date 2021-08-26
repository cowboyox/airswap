import { LightOrder } from "@airswap/types";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { Transaction } from "ethers";

import { RootState } from "../../app/store";
import { notifyTransaction } from "../../components/Toasts/ToastController";
import { allowancesActions } from "../balances/balancesSlice";
import {
  submitTransaction,
  mineTransaction,
  revertTransaction,
  declineTransaction,
} from "../transactions/transactionActions";
import {
  SubmittedOrder,
  SubmittedApproval,
} from "../transactions/transactionsSlice";
import {
  setWalletConnected,
  setWalletDisconnected,
} from "../wallet/walletSlice";
import {
  requestOrder,
  takeOrder,
  approveToken,
  orderSortingFunction,
} from "./orderAPI";

export interface OrdersState {
  orders: LightOrder[];
  status: "idle" | "requesting" | "approving" | "taking" | "failed";
}

const initialState: OrdersState = {
  orders: [],
  status: "idle",
};

export const request = createAsyncThunk(
  "orders/request",
  async (params: {
    chainId: number;
    signerToken: string;
    senderToken: string;
    senderAmount: string;
    senderTokenDecimals: number;
    senderWallet: string;
    provider: any;
  }) =>
    await requestOrder(
      params.chainId,
      params.signerToken,
      params.senderToken,
      params.senderAmount,
      params.senderTokenDecimals,
      params.senderWallet,
      params.provider
    )
);

export const approve = createAsyncThunk(
  "orders/approve",
  async (params: any, { getState, dispatch }) => {
    let tx: Transaction;
    try {
      tx = await approveToken(params.token, params.library);
      if (tx.hash) {
        const transaction: SubmittedApproval = {
          type: "Approval",
          hash: tx.hash,
          status: "processing",
          tokenAddress: params.token,
          timestamp: Date.now(),
        };
        dispatch(submitTransaction(transaction));
        params.library.once(tx.hash, async () => {
          const receipt = await params.library.getTransactionReceipt(tx.hash);
          const state: RootState = getState() as RootState;
          const tokens = Object.values(state.metadata.tokens.all);
          if (receipt.status === 1) {
            dispatch(mineTransaction(receipt.transactionHash));
            // Optimistically update allowance (this is not really optimisitc,
            // but it pre-empts receiving the event)
            dispatch(
              allowancesActions.set({
                tokenAddress: params.token,
                amount: "90071992547409910000000000",
              })
            );
            notifyTransaction("Approval", transaction, tokens, false);
          } else {
            dispatch(revertTransaction(receipt.transactionHash));
            notifyTransaction("Approval", transaction, tokens, true);
          }
        });
      }
    } catch (e) {
      console.error(e);
      dispatch(declineTransaction(e.message));
      throw e;
    }
  }
);

export const take = createAsyncThunk(
  "orders/take",
  async (
    params: { order: LightOrder; library: any },
    { getState, dispatch }
  ) => {
    let tx: Transaction;
    try {
      tx = await takeOrder(params.order, params.library);
      if (tx.hash) {
        const transaction: SubmittedOrder = {
          type: "Order",
          order: params.order,
          hash: tx.hash,
          status: "processing",
          timestamp: Date.now(),
        };
        dispatch(submitTransaction(transaction));
        params.library.once(tx.hash, async () => {
          const receipt = await params.library.getTransactionReceipt(tx.hash);
          const state: RootState = getState() as RootState;
          const tokens = Object.values(state.metadata.tokens.all);
          if (receipt.status === 1) {
            dispatch(mineTransaction(receipt.transactionHash));
            notifyTransaction("Order", transaction, tokens, false);
          } else {
            dispatch(revertTransaction(receipt.transactionHash));
            notifyTransaction("Order", transaction, tokens, true);
          }
        });
      }
    } catch (e) {
      console.error(e);
      dispatch(declineTransaction(e.message));
      throw e;
    }
  }
);

export const ordersSlice = createSlice({
  name: "orders",
  initialState,
  reducers: {
    clear: (state) => {
      state.orders = [];
      state.status = "idle";
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(request.pending, (state) => {
        state.status = "requesting";
      })
      .addCase(request.fulfilled, (state, action) => {
        state.status = "idle";
        state.orders = action.payload!;
      })
      .addCase(request.rejected, (state, action) => {
        state.status = "failed";
        state.orders = [];
      })
      .addCase(take.pending, (state) => {
        state.status = "taking";
      })
      .addCase(take.fulfilled, (state, action) => {
        state.status = "idle";
      })
      .addCase(take.rejected, (state, action) => {
        state.status = "failed";
      })
      .addCase(approve.pending, (state) => {
        state.status = "approving";
      })
      .addCase(approve.fulfilled, (state) => {
        state.status = "idle";
      })
      .addCase(approve.rejected, (state) => {
        state.status = "failed";
      })
      .addCase(setWalletConnected, (state) => {
        state.status = "idle";
        state.orders = [];
      })
      .addCase(setWalletDisconnected, (state) => {
        state.status = "idle";
        state.orders = [];
      });
  },
});

export const { clear } = ordersSlice.actions;
/**
 * Sorts orders and returns the best order based on tokens received or sent
 * then falling back to expiry.
 */
export const selectBestOrder = (state: RootState) =>
  // Note that `.sort` mutates the array, so we need to clone it first to
  // prevent mutating state.
  [...state.orders.orders].sort(orderSortingFunction)[0];

export const selectSortedOrders = (state: RootState) =>
  [...state.orders.orders].sort(orderSortingFunction);
export const selectOrdersStatus = (state: RootState) => state.orders.status;
export default ordersSlice.reducer;
