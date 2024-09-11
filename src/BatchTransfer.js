import React, { useState } from 'react';
import { ethers } from 'ethers';
import { 
  Button, 
  Input, 
  Select, 
  Form, 
  Typography, 
  Card,
  message,
  Space,
  Modal
} from 'antd';

const { Option } = Select;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// Multicall3 ABI
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
  "function aggregate3Value(tuple(address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)"
];

// Extended ERC20 ABI
const ERC20_ABI = [
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)"
];

const MULTICALL3_ADDRESS = "0x298F215CdDf542CeC4ACbCF1A2D9e6b3DB51D90A"; // Multicall3 Address

const BatchTransfer = () => {
  const [form] = Form.useForm();
  const [transferType, setTransferType] = useState('ETH');
  const [isApproved, setIsApproved] = useState(false);
  const [errorDetails, setErrorDetails] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');

  const checkAndApproveAllowance = async (tokenAddress, signer, totalAmount) => {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const owner = await signer.getAddress();
    const currentAllowance = await tokenContract.allowance(owner, MULTICALL3_ADDRESS);
    
    if (currentAllowance < totalAmount) {
      try {
        const approveTx = await tokenContract.approve(MULTICALL3_ADDRESS, totalAmount);
        await approveTx.wait();
        message.success('Approval successful');
        setIsApproved(true);
      } catch (error) {
        console.error('Approval error:', error);
        throw new Error(`Failed to approve tokens: ${error.message}`);
      }
    } else {
      setIsApproved(true);
    }
  };

  const checkAllowance = async (tokenAddress, signer, totalAmount) => {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const owner = await signer.getAddress();
    const allowance = await tokenContract.allowance(owner, MULTICALL3_ADDRESS);
    if (allowance < totalAmount) {
      throw new Error(`Insufficient allowance. You have approved ${ethers.formatUnits(allowance, await getTokenDecimals(tokenAddress, signer))} tokens, but ${ethers.formatUnits(totalAmount, await getTokenDecimals(tokenAddress, signer))} tokens are required.`);
    }
  };

  const checkBalance = async (tokenAddress, signer, totalAmount) => {
    const address = await signer.getAddress();
    if (transferType === 'ETH') {
      const balance = await signer.provider.getBalance(address);
      if (balance < totalAmount) {
        throw new Error(`Insufficient ETH balance. You have ${ethers.formatEther(balance)} ETH, but ${ethers.formatEther(totalAmount)} ETH is required.`);
      }
    } else {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const balance = await tokenContract.balanceOf(address);
      if (balance < totalAmount) {
        const decimals = await getTokenDecimals(tokenAddress, signer);
        throw new Error(`Insufficient token balance. You have ${ethers.formatUnits(balance, decimals)} tokens, but ${ethers.formatUnits(totalAmount, decimals)} tokens are required.`);
      }
    }
  };

  const debugTransaction = async (tokenAddress, signer, calls) => {
    let debug = "Debug Information:\n";
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const owner = await signer.getAddress();
    const balance = await tokenContract.balanceOf(owner);
    const allowance = await tokenContract.allowance(owner, MULTICALL3_ADDRESS);
    const decimals = await getTokenDecimals(tokenAddress, signer);
    
    debug += `Owner Address: ${owner}\n`;
    debug += `Token Balance: ${ethers.formatUnits(balance, decimals)}\n`;
    debug += `Allowance for Multicall3: ${ethers.formatUnits(allowance, decimals)}\n`;
    debug += `Number of Calls: ${calls.length}\n`;
    
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const decodedData = tokenContract.interface.decodeFunctionData('transferFrom', call.callData);
      debug += `\nCall ${i + 1}:\n`;
      debug += `  From: ${decodedData[0]}\n`;
      debug += `  To: ${decodedData[1]}\n`;
      debug += `  Amount: ${ethers.formatUnits(decodedData[2], decimals)}\n`;
    }

    return debug;
  };

  const parseRecipients = (text) => {
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const [address, amount] = line.split(' ');
        return { address: address.trim(), amount: amount.trim() };
      });
  };

  const getTokenDecimals = async (tokenAddress, signer) => {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    try {
      const decimals = await tokenContract.decimals();
      return decimals;
    } catch (error) {
      console.error('Error getting token decimals:', error);
      message.error('Failed to get token decimals. Using default of 18.');
      return 18;
    }
  };

  const calculateTotalAmount = (recipients, decimals) => {
    return recipients.reduce((total, recipient) => {
      return total + ethers.parseUnits(recipient.amount, decimals);
    }, ethers.parseUnits("0", decimals));
  };

  const approveERC20 = async (tokenAddress, recipients) => {
    if (typeof window.ethereum === 'undefined') {
      message.error('Please install MetaMask!');
      return;
    }

    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      
      const decimals = await getTokenDecimals(tokenAddress, signer);
      const totalAmount = calculateTotalAmount(recipients, decimals);
      
      const tx = await tokenContract.approve(MULTICALL3_ADDRESS, totalAmount);
      await tx.wait();
      
      setIsApproved(true);
      message.success('ERC20 token approved successfully!');
    } catch (error) {
      console.error('Error approving ERC20 token:', error);
      message.error('Failed to approve ERC20 token. Check console for details.');
    }
  };

  const onFinish = async (values) => {
    if (typeof window.ethereum === 'undefined') {
      message.error('Please install MetaMask!');
      return;
    }

    try {
      const recipients = parseRecipients(values.recipientsText);

      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const fromAddress = await signer.getAddress();

      const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, signer);

      let calls = [];
      let totalValue = ethers.parseEther("0");

      if (transferType === 'ETH') {
        calls = recipients.map(recipient => ({
          target: recipient.address,
          allowFailure: false,
          value: ethers.parseEther(recipient.amount),
          callData: '0x'
        }));
        totalValue = calls.reduce((sum, call) => sum + call.value, ethers.parseEther("0"));
      } else {
        const tokenDecimals = await getTokenDecimals(values.tokenAddress, signer);
        const tokenContract = new ethers.Contract(values.tokenAddress, ERC20_ABI, signer);
        calls = recipients.map(recipient => ({
          target: values.tokenAddress,
          allowFailure: false,
          callData: tokenContract.interface.encodeFunctionData('transferFrom', [
            fromAddress,
            recipient.address,
            ethers.parseUnits(recipient.amount, tokenDecimals)
          ])
        }));
        totalValue = calculateTotalAmount(recipients, tokenDecimals);

        // Check and approve allowance
        await checkAndApproveAllowance(values.tokenAddress, signer, totalValue);
      }

      // Check balance
      await checkBalance(values.tokenAddress, signer, totalValue);

      // Debug information
      // const debugInfo = await debugTransaction(values.tokenAddress, signer, calls);
      // setDebugInfo(debugInfo);

      let tx;
      if (transferType === 'ETH') {
        tx = await multicall.aggregate3Value(calls, { value: totalValue });
      } else {
        tx = await multicall.aggregate3(calls);
      }
      
      const receipt = await tx.wait();
      
      // Check the status of each call
      const failedCalls = receipt.logs
        .filter(log => log.topics[0] === ethers.id("CallFailed(uint256)"))
        .map(log => parseInt(log.topics[1]));

      if (failedCalls.length > 0) {
        const errorMsg = `Some calls failed: ${failedCalls.join(', ')}`;
        setErrorDetails(errorMsg);
        setIsModalVisible(true);
        message.error('Some transfers failed. Check details for more information.');
      } else {
        message.success('Batch transfer successful!');
      }
    } catch (error) {
      console.error('Error:', error);
      setErrorDetails(error.message);
      setIsModalVisible(true);
      message.error('Batch transfer failed. Check details for more information.');
    }
  };

  return (
    <Card style={{ maxWidth: 600, margin: 'auto' }}>
      <Title level={3}>Multicall3 Batch Transfer</Title>
      
      <Form form={form} onFinish={onFinish} layout="vertical">
        <Form.Item name="transferType" label="Transfer Type">
          <Select onChange={(value) => {
            setTransferType(value);
            setIsApproved(false);
          }} defaultValue="ETH">
            <Option value="ETH">ETH</Option>
            <Option value="ERC20">ERC20</Option>
          </Select>
        </Form.Item>

        {transferType === 'ERC20' && (
          <Form.Item
            name="tokenAddress"
            label="ERC20 Token Address"
            rules={[{ required: true, message: 'Please input the ERC20 token address' }]}
          >
            <Input />
          </Form.Item>
        )}

        <Form.Item
          name="recipientsText"
          label="Recipients (Address Amount, one per line)"
          rules={[{ required: true, message: 'Please input recipients' }]}
        >
          <TextArea
            rows={10}
            placeholder="0x1234... 1.5&#10;0x5678... 2.3&#10;..."
          />
        </Form.Item>

        {transferType === 'ERC20' && (
          <Form.Item>
            <Button onClick={() => {
              const tokenAddress = form.getFieldValue('tokenAddress');
              const recipientsText = form.getFieldValue('recipientsText');
              const recipients = parseRecipients(recipientsText);
              approveERC20(tokenAddress, recipients);
            }}>
              Approve ERC20
            </Button>
          </Form.Item>
        )}

        <Form.Item>
          <Button type="primary" htmlType="submit">
            Execute Batch Transfer
          </Button>
        </Form.Item>
      </Form>

      <Modal
        title="Error Details"
        visible={isModalVisible}
        onOk={() => setIsModalVisible(false)}
        onCancel={() => setIsModalVisible(false)}
        width={800}
      >
        <Paragraph>
          <Text strong>Error Message:</Text>
          <br />
          {errorDetails}
        </Paragraph>
        <Paragraph>
          <Text strong>Debug Information:</Text>
          <br />
          <pre>{debugInfo}</pre>
        </Paragraph>
      </Modal>
    </Card>
  );
};

export default BatchTransfer;