package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type CouchDBClient struct {
	URL      string
	Database string
	Login    string
	Token    string
	client   *http.Client
}

func NewCouchDBClient(url, database, login, token string) *CouchDBClient {
	return &CouchDBClient{
		URL:      url,
		Database: database,
		Login:    login,
		Token:    token,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *CouchDBClient) authHeader() string {
	creds := c.Login + ":" + c.Token
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(creds))
}

type CouchDBAllDocsResponse struct {
	TotalRows int             `json:"total_rows"`
	Offset    int             `json:"offset"`
	Rows      []CouchDBDocRow `json:"rows"`
}

type CouchDBDocRow struct {
	ID    string          `json:"id"`
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
	Doc   json.RawMessage `json:"doc"`
}

type BBDocument struct {
	ID                string `json:"_id"`
	Rev               string `json:"_rev"`
	ReservedModelType string `json:"reservedModelType"`
	Name              string `json:"name"`
	CurrencyID        string `json:"currencyId"`
	InitAmount        int64  `json:"initAmount"`
	DecimalInitAmount string `json:"decimalInitAmount"`
	ExcludeFromStats  bool   `json:"excludeFromStats"`
	Archived          bool   `json:"archived"`
	AccountID         string `json:"accountId"`
	Amount            int64  `json:"amount"`
	DecimalAmount     string `json:"decimalAmount"`
	RecordDate        string `json:"recordDate"`
	CurrencyCode      string `json:"currencyCode"`
	Type              int    `json:"type"`
}

type BBAccount struct {
	ID               string
	Name             string
	CurrencyCode     string
	InitAmountCents  int64
	ExcludeFromStats bool
	Archived         bool
}

type BBRecord struct {
	ID          string
	AccountID   string
	AmountCents int64
	RecordDate  time.Time
	Type        int
}

type BBCurrency struct {
	ID   string
	Code string
}

func (c *CouchDBClient) FetchAllDocs(ctx context.Context) (*CouchDBAllDocsResponse, error) {
	url := fmt.Sprintf("%s/%s/_all_docs?include_docs=true", c.URL, c.Database)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Authorization", c.authHeader())
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("couchdb error %d: %s", resp.StatusCode, string(body))
	}

	var result CouchDBAllDocsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

type BBData struct {
	Accounts   []BBAccount
	Records    []BBRecord
	Currencies map[string]string
}

func (c *CouchDBClient) FetchBBData(ctx context.Context) (*BBData, error) {
	allDocs, err := c.FetchAllDocs(ctx)
	if err != nil {
		return nil, err
	}

	data := &BBData{
		Accounts:   make([]BBAccount, 0),
		Records:    make([]BBRecord, 0),
		Currencies: make(map[string]string),
	}

	for _, row := range allDocs.Rows {
		var doc BBDocument
		if err := json.Unmarshal(row.Doc, &doc); err != nil {
			continue
		}

		switch doc.ReservedModelType {
		case "Currency":
			var curr struct {
				ID   string `json:"_id"`
				Code string `json:"code"`
			}
			if err := json.Unmarshal(row.Doc, &curr); err == nil && curr.Code != "" {
				data.Currencies[curr.ID] = curr.Code
			}

		case "Account":
			account := BBAccount{
				ID:               doc.ID,
				Name:             doc.Name,
				CurrencyCode:     doc.CurrencyID,
				InitAmountCents:  doc.InitAmount,
				ExcludeFromStats: doc.ExcludeFromStats,
				Archived:         doc.Archived,
			}
			data.Accounts = append(data.Accounts, account)

		case "Record":
			recordDate, _ := time.Parse(time.RFC3339, doc.RecordDate)
			record := BBRecord{
				ID:          doc.ID,
				AccountID:   doc.AccountID,
				AmountCents: doc.Amount,
				RecordDate:  recordDate,
				Type:        doc.Type,
			}
			data.Records = append(data.Records, record)
		}
	}

	for i := range data.Accounts {
		if code, ok := data.Currencies[data.Accounts[i].CurrencyCode]; ok {
			data.Accounts[i].CurrencyCode = code
		}
	}

	return data, nil
}

func (data *BBData) CalculateAccountBalances() map[string]int64 {
	balances := make(map[string]int64)

	for _, acc := range data.Accounts {
		balances[acc.ID] = acc.InitAmountCents
	}

	for _, rec := range data.Records {
		if _, ok := balances[rec.AccountID]; ok {
			if rec.Type == 0 {
				balances[rec.AccountID] += rec.AmountCents
			} else if rec.Type == 1 {
				balances[rec.AccountID] -= rec.AmountCents
			}
		}
	}

	return balances
}
