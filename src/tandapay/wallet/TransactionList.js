// @flow strict-local

/**
 * TransactionList component that works with the new transfer system
 *
 * This component handles the new transfer format while maintaining compatibility
 * with the existing UI components.
 */

import React, { useState, useContext, useEffect } from 'react';
import type { Node } from 'react';
import { View, ActivityIndicator } from 'react-native';

import ZulipButton from '../../common/ZulipButton';
import ZulipText from '../../common/ZulipText';
import { QUARTER_COLOR, ThemeContext } from '../../styles';
import { convertTransferToEtherscanFormat } from './TransactionFormatter';
import { formatTimestamp } from './TransactionUtils';
import TransactionDetailsModal from './TransactionDetailsModal';
import type { LoadMoreState } from './useTransactionHistory';
import type { TandaPayError } from '../errors/types';
import TandaPayStyles, { TandaPayColors } from '../styles';
import ZulipTextButton from '../../common/ZulipTextButton';
import type { SupportedNetwork } from '../definitions/types';
import { useSelector } from '../../react-redux';
import { getCurrentTandaPayContractAddress } from '../redux/selectors';

type Transfer = mixed;

export type TransactionState =
  | {| status: 'idle' |}
  | {| status: 'loading' |}
  | {| status: 'success', transfers: $ReadOnlyArray<Transfer>, hasMore: boolean |}
  | {| status: 'error', error: TandaPayError |};

type Props = {|
  walletAddress: string,
  apiKeyConfigured: boolean,
  network?: SupportedNetwork,
  transactionState: TransactionState,
  loadMoreState: LoadMoreState,
  onLoadMore: () => void,
  onRefresh: () => void,
  onGoToSettings: () => void,
  onViewExplorer: () => void,
  onViewTransactionInExplorer: (txHash: string) => void,
|};

export default function TransactionList({
  walletAddress,
  apiKeyConfigured,
  network = 'sepolia',
  transactionState,
  loadMoreState,
  onLoadMore,
  onRefresh,
  onGoToSettings,
  onViewExplorer,
  onViewTransactionInExplorer,
}: Props): Node {
  const [selectedTransaction, setSelectedTransaction] = useState<?mixed>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [processedTransactions, setProcessedTransactions] = useState([]);
  const [isProcessingTransactions, setIsProcessingTransactions] = useState(false);
  const themeData = useContext(ThemeContext);

  // Get TandaPay contract address from Redux for transaction decoding
  const tandaPayContractAddress = useSelector(getCurrentTandaPayContractAddress);

  // Process transactions with TandaPay decoding when they change
  useEffect(() => {
    if (transactionState.status === 'success' && transactionState.transfers.length > 0) {
      setIsProcessingTransactions(true);
      
      // Process transactions asynchronously
      const processTransactions = async () => {
        try {
          const processed = await Promise.all(
            transactionState.transfers.map(async (transfer) => {
              try {
                return await convertTransferToEtherscanFormat(transfer, walletAddress, tandaPayContractAddress, network);
              } catch (error) {
                // If processing fails, return the original transfer
                return transfer;
              }
            })
          );
          setProcessedTransactions(processed);
        } catch (error) {
          // If all processing fails, use original transfers
          setProcessedTransactions(transactionState.transfers);
        } finally {
          setIsProcessingTransactions(false);
        }
      };

      processTransactions();
    } else {
      setProcessedTransactions([]);
      setIsProcessingTransactions(false);
    }
  }, [transactionState, walletAddress, tandaPayContractAddress, network]);

  const showTransactionDetails = async (transfer: Transfer) => {
    try {
      // Convert transfer to etherscan format for the modal, including TandaPay decoding
      const etherscanTransaction = await convertTransferToEtherscanFormat(transfer, walletAddress, tandaPayContractAddress, network);
      setSelectedTransaction(etherscanTransaction);
      setModalVisible(true);
    } catch (error) {
      // If conversion fails, fall back to basic display
      setSelectedTransaction(transfer);
      setModalVisible(true);
    }
  };

  const hideTransactionDetails = () => {
    setModalVisible(false);
    setSelectedTransaction(null);
  };

  // Handle API key not configured state
  if (!apiKeyConfigured) {
    return (
      <View style={{ padding: 20, alignItems: 'center', backgroundColor: themeData.backgroundColor }}>
        <ZulipText style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: themeData.color }}>
          🔑 API Key Required
        </ZulipText>
        <ZulipText style={{ textAlign: 'center', marginBottom: 15, color: themeData.color }}>
          Configure an Alchemy API key in wallet settings to view transaction history.
        </ZulipText>
        <ZulipButton
          text="Configure API Key"
          onPress={onGoToSettings}
        />
      </View>
    );
  }

  // Handle wallet address not set
  if (!walletAddress || walletAddress.length === 0) {
    return (
      <View style={{ padding: 20, alignItems: 'center', backgroundColor: themeData.backgroundColor }}>
        <ZulipText style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: themeData.color }}>
          💰 No Wallet Connected
        </ZulipText>
        <ZulipText style={{ textAlign: 'center', marginBottom: 15, color: themeData.color }}>
          Please connect a wallet to view transaction history.
        </ZulipText>
        <ZulipButton
          text="Connect Wallet"
          onPress={onGoToSettings}
        />
      </View>
    );
  }

  // Handle error state
  if (transactionState.status === 'error') {
    const error = transactionState.error;
    return (
      <View style={{ padding: 20, alignItems: 'center', backgroundColor: themeData.backgroundColor }}>
        <ZulipText style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: themeData.color }}>
          ❌ Failed to Load Transactions
        </ZulipText>
        <ZulipText style={{ textAlign: 'center', marginBottom: 15, color: themeData.color }}>
          {error.userMessage != null && error.userMessage !== '' ? error.userMessage : 'Unable to fetch transaction history.'}
        </ZulipText>
        <ZulipButton
          text="Try Again"
          onPress={onRefresh}
        />
      </View>
    );
  }

  // Handle loading state
  if (transactionState.status === 'loading') {
    return (
      <View style={{ padding: 20, alignItems: 'center', backgroundColor: themeData.backgroundColor }}>
        <ActivityIndicator size="large" color={QUARTER_COLOR} />
        <ZulipText style={{ marginTop: 10, textAlign: 'center', color: themeData.color }}>
          Loading transactions...
        </ZulipText>
      </View>
    );
  }

  // Handle success state with no transactions
  if (transactionState.status === 'success' && transactionState.transfers.length === 0) {
    return (
      <View style={{ padding: 20, alignItems: 'center', backgroundColor: themeData.backgroundColor }}>
        <ZulipText style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: themeData.color }}>
          📭 No Transactions Found
        </ZulipText>
        <ZulipText style={{ textAlign: 'center', marginBottom: 15, color: themeData.color }}>
          This wallet has no transaction history yet.
        </ZulipText>
      </View>
    );
  }

  // Handle success state with transactions
  if (transactionState.status === 'success') {
    const { hasMore } = transactionState;

    return (
      <View style={{ backgroundColor: themeData.backgroundColor }}>
        {/* Transaction List */}
        {(isProcessingTransactions ? transactionState.transfers : processedTransactions).map((transaction, index) => {
          // For processed transactions, use them directly. For unprocessed, use basic format
          let etherscanTransaction;
          
          if (isProcessingTransactions) {
            // $FlowFixMe[unclear-type] - Using basic transfer data while processing
            etherscanTransaction = (transaction: any);
            // Create a basic formatted version for display
            etherscanTransaction = {
              hash: etherscanTransaction?.hash || '',
              direction: etherscanTransaction?.direction || 'OUT',
              formattedValue: '0 ETH',
              timeStamp: etherscanTransaction?.metadata?.blockTimestamp || '0',
              isTandaPayTransaction: false,
              tandaPaySummary: null,
            };
          } else {
            // $FlowFixMe[unclear-type] - Processed transaction data
            etherscanTransaction = (transaction: any);
          }

          // Determine color and display content based on transaction type
          let displayColor;
          let displayTitle;
          let displayAmount;

          if (etherscanTransaction.isTandaPayTransaction) {
            // TandaPay transaction - use warning color
            displayColor = TandaPayColors.warning;
            displayTitle = 'Sent TandaPay Action';
            displayAmount = etherscanTransaction.tandaPaySummary != null && etherscanTransaction.tandaPaySummary !== ''
              ? etherscanTransaction.tandaPaySummary
              : 'Contract Call';
          } else {
            // Regular transaction - use existing logic
            displayColor = etherscanTransaction.direction === 'IN' ? TandaPayColors.success : TandaPayColors.error;
            displayTitle = etherscanTransaction.direction === 'IN' ? 'Received' : 'Sent';
            displayAmount = etherscanTransaction.formattedValue;
          }

          return (
            <View
              key={`${etherscanTransaction.hash || `transfer-${index}`}-${etherscanTransaction.direction}`}
              style={{ padding: 12, marginVertical: 2, backgroundColor: themeData.cardColor, borderRadius: 8 }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <ZulipText style={{ fontSize: 16, color: displayColor }}>
                    {displayTitle}
                  </ZulipText>
                  <ZulipText style={TandaPayStyles.descriptionCompact}>
                    {displayAmount}
                  </ZulipText>
                  <ZulipText style={TandaPayStyles.descriptionCompact}>
                    {formatTimestamp(etherscanTransaction.timeStamp)}
                  </ZulipText>
                </View>
                <ZulipTextButton
                  label="View"
                  onPress={() => showTransactionDetails(isProcessingTransactions ? transactionState.transfers[index] : transaction)}
                />
              </View>
            </View>
          );
        })}

        {/* Load More Button */}
        {hasMore && (
          <View style={TandaPayStyles.buttonRow}>
            {loadMoreState.status === 'loading' ? (
              <ActivityIndicator size="small" color={QUARTER_COLOR} />
            ) : (
              <ZulipButton
                style={TandaPayStyles.button}
                text="Load More"
                onPress={onLoadMore}
                disabled={loadMoreState.status === 'complete'}
              />
            )}
          </View>
        )}

        {/* Transaction Details Modal */}
        {selectedTransaction != null && (
          <TransactionDetailsModal
            visible={modalVisible}
            onClose={hideTransactionDetails}
            transaction={selectedTransaction}
            walletAddress={walletAddress}
            network={network}
            onViewInExplorer={onViewTransactionInExplorer}
          />
        )}
      </View>
    );
  }

  // Default loading state
  return (
    <View style={{ padding: 20, alignItems: 'center', backgroundColor: themeData.backgroundColor }}>
      <ActivityIndicator size="large" color={QUARTER_COLOR} />
    </View>
  );
}
