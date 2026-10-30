#!/bin/bash
# FirstLight Database Restore Script
# Restores database from backup

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Parse arguments
DB_TYPE="${DB_TYPE:-auto}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-firstlight}"
DB_USER="${DB_USER:-firstlight}"
DB_PASSWORD="${DB_PASSWORD:-}"
SQLITE_PATH="${SQLITE_PATH:-db/firstlight.db}"
BACKUP_DIR="${BACKUP_DIR:-./db-backup-latest}"
BACKUP_FILE="${BACKUP_FILE:-}"
DECRYPT="${DECRYPT:-false}"
DECRYPT_KEY="${DECRYPT_KEY:-}"
DROP_EXISTING="${DROP_EXISTING:-false}"

# Show help
show_help() {
    cat << EOF
FirstLight Database Restore Script

Usage: $0 [OPTIONS]

Options:
  --db-type TYPE        Database type: sqlite, postgres, or auto (default: auto)
  --db-host HOST        Database host (default: localhost)
  --db-port PORT        Database port (default: 5432)
  --db-name NAME        Database name (default: firstlight)
  --db-user USER        Database user (default: firstlight)
  --db-password PASS    Database password
  --sqlite-path PATH    Path to SQLite database (default: db/firstlight.db)
  --backup-dir DIR      Backup directory (default: ./db-backup-latest)
  --backup-file FILE    Specific backup file to restore
  --decrypt             Decrypt backup files (requires openssl)
  --decrypt-key KEY     Decryption key (required if --decrypt)
  --drop-existing       Drop existing database before restore (default: false)
  --dry-run             Perform dry run
  --help                Show this help message

Examples:
  $0 --db-type sqlite --backup-dir ./my-backup
  $0 --db-type postgres --db-password secret123 --backup-file backup.sql.gz
  $0 --decrypt --decrypt-key mysecretkey --backup-file backup.sql.gz.enc
  $0 --drop-existing --db-password secret123

Note: For SQLite, only --sqlite-path and --backup-dir are required.
      For PostgreSQL, --db-host, --db-port, --db-name, --db-user, --db-password are required.
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --db-type)
            DB_TYPE="$2"
            shift 2
            ;;
        --db-host)
            DB_HOST="$2"
            shift 2
            ;;
        --db-port)
            DB_PORT="$2"
            shift 2
            ;;
        --db-name)
            DB_NAME="$2"
            shift 2
            ;;
        --db-user)
            DB_USER="$2"
            shift 2
            ;;
        --db-password)
            DB_PASSWORD="$2"
            shift 2
            ;;
        --sqlite-path)
            SQLITE_PATH="$2"
            shift 2
            ;;
        --backup-dir)
            BACKUP_DIR="$2"
            shift 2
            ;;
        --backup-file)
            BACKUP_FILE="$2"
            shift 2
            ;;
        --decrypt)
            DECRYPT="true"
            shift
            ;;
        --decrypt-key)
            DECRYPT_KEY="$2"
            shift 2
            ;;
        --drop-existing)
            DROP_EXISTING="true"
            shift
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate decryption
if [ "$DECRYPT" = "true" ] && [ -z "$DECRYPT_KEY" ]; then
    log_error "Decryption key is required when --decrypt is specified"
    show_help
    exit 1
fi

# Detect database type if auto
if [ "$DB_TYPE" = "auto" ]; then
    if [ -f "$SQLITE_PATH" ]; then
        DB_TYPE="sqlite"
        log_info "Auto-detected database type: SQLite"
    else
        DB_TYPE="postgres"
        log_info "Auto-detected database type: PostgreSQL"
    fi
fi

# Validate database type
if [ "$DB_TYPE" != "sqlite" ] && [ "$DB_TYPE" != "postgres" ]; then
    log_error "Invalid database type: $DB_TYPE. Must be 'sqlite' or 'postgres'"
    show_help
    exit 1
fi

# Validate SQLite
if [ "$DB_TYPE" = "sqlite" ]; then
    # Create parent directory if it doesn't exist
    mkdir -p "$(dirname "$SQLITE_PATH")"
fi

# Validate PostgreSQL
if [ "$DB_TYPE" = "postgres" ]; then
    if [ -z "$DB_PASSWORD" ]; then
        log_error "PostgreSQL password is required"
        show_help
        exit 1
    fi
    
    # Test connection
    if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" -c "SELECT 1" >/dev/null 2>&1; then
        log_error "Failed to connect to PostgreSQL"
        log_error "Host: $DB_HOST:$DB_PORT, User: $DB_USER"
        exit 1
    fi
    
    # Check if database exists
    DB_EXISTS=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "postgres" -t -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | tr -d ' \n')
    
    if [ "$DB_EXISTS" = "1" ] && [ "$DROP_EXISTING" = "true" ]; then
        if [ "$DRY_RUN" != "true" ]; then
            log_info "Dropping existing database: $DB_NAME"
            PGPASSWORD="$DB_PASSWORD" dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
            log_success "Database dropped"
        else
            log_info "[DRY RUN] Would drop existing database: $DB_NAME"
        fi
    elif [ "$DB_EXISTS" = "1" ]; then
        log_warning "Database '$DB_NAME' already exists. Use --drop-existing to overwrite."
        read -p "Do you want to continue and overwrite existing data? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Restore cancelled"
            exit 0
        fi
        DROP_EXISTING="true"
        if [ "$DRY_RUN" != "true" ]; then
            PGPASSWORD="$DB_PASSWORD" dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
        fi
    fi
    
    # Create database
    if [ "$DRY_RUN" != "true" ]; then
        log_info "Creating database: $DB_NAME"
        PGPASSWORD="$DB_PASSWORD" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
        log_success "Database created"
    else
        log_info "[DRY RUN] Would create database: $DB_NAME"
    fi
fi

# Find backup file
find_backup_file() {
    if [ -n "$BACKUP_FILE" ]; then
        # Use specified file
        if [ ! -f "$BACKUP_FILE" ]; then
            log_error "Backup file not found: $BACKUP_FILE"
            exit 1
        fi
        echo "$BACKUP_FILE"
        return
    fi
    
    # Find latest backup in directory
    if [ -d "$BACKUP_DIR" ]; then
        # Find most recent backup file
        local latest_file=$(find "$BACKUP_DIR" -type f -name "firstlight-*" | sort -r | head -n 1)
        
        if [ -n "$latest_file" ]; then
            echo "$latest_file"
            return
        else
            log_error "No backup files found in $BACKUP_DIR"
            exit 1
        fi
    else
        log_error "Backup directory not found: $BACKUP_DIR"
        exit 1
    fi
}

# Decrypt file if needed
decrypt_file() {
    local input_file="$1"
    local output_file="${input_file%.enc}"
    
    if [[ "$input_file" == *.enc ]]; then
        if [ "$DECRYPT" = "true" ]; then
            if [ "$DRY_RUN" != "true" ]; then
                log_info "Decrypting: $input_file"
                openssl enc -d -aes-256-cbc -in "$input_file" -out "$output_file" -pass pass:"$DECRYPT_KEY"
                echo "$output_file"
            else
                log_info "[DRY RUN] Would decrypt: $input_file"
                echo "$output_file"
            fi
        else
            log_error "File is encrypted but --decrypt not specified"
            exit 1
        fi
    else
        echo "$input_file"
    fi
}

# Decompress file if needed
decompress_file() {
    local input_file="$1"
    local output_file=""
    
    if [[ "$input_file" == *.gz ]]; then
        output_file="${input_file%.gz}"
        if [ "$DRY_RUN" != "true" ]; then
            log_info "Decompressing: $input_file"
            gunzip -k "$input_file"
        else
            log_info "[DRY RUN] Would decompress: $input_file"
        fi
        echo "$output_file"
    elif [[ "$input_file" == *.sql.gz ]]; then
        output_file="${input_file%.gz}"
        if [ "$DRY_RUN" != "true" ]; then
            log_info "Decompressing: $input_file"
            gunzip -k "$input_file"
        else
            log_info "[DRY RUN] Would decompress: $input_file"
        fi
        echo "$output_file"
    else
        echo "$input_file"
    fi
}

# Restore SQLite
restore_sqlite() {
    local backup_file=$(find_backup_file)
    local decrypted_file=$(decrypt_file "$backup_file")
    local decompressed_file=$(decompress_file "$decrypted_file")
    
    log_info "Restoring SQLite database..."
    log_info "  From: $backup_file"
    log_info "  To: $SQLITE_PATH"
    
    if [ "$DRY_RUN" != "true" ]; then
        # Determine file type
        if [[ "$decompressed_file" == *.db ]]; then
            # Direct database file
            cp "$decompressed_file" "$SQLITE_PATH"
            log_success "SQLite database restored from file"
        elif [[ "$decompressed_file" == *.sql ]]; then
            # SQL dump
            sqlite3 "$SQLITE_PATH" < "$decompressed_file"
            log_success "SQLite database restored from SQL dump"
        else
            log_error "Unknown backup file type: $decompressed_file"
            exit 1
        fi
        
        # Clean up temporary files
        if [ "$decrypted_file" != "$decompressed_file" ]; then
            rm -f "$decrypted_file"
        fi
        if [ "$backup_file" != "$decompressed_file" ]; then
            rm -f "$decompressed_file"
        fi
    else
        log_info "[DRY RUN] Would restore SQLite database from $backup_file to $SQLITE_PATH"
    fi
}

# Restore PostgreSQL
restore_postgres() {
    local backup_file=$(find_backup_file)
    local decrypted_file=$(decrypt_file "$backup_file")
    local decompressed_file=$(decompress_file "$decrypted_file")
    
    log_info "Restoring PostgreSQL database..."
    log_info "  From: $backup_file"
    log_info "  To: $DB_HOST:$DB_PORT/$DB_NAME"
    
    if [ "$DRY_RUN" != "true" ]; then
        # Determine file type
        if [[ "$decompressed_file" == *.sql ]]; then
            # Plain SQL dump
            PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$decompressed_file"
            log_success "PostgreSQL database restored from SQL dump"
        elif [[ "$decompressed_file" == *.custom ]]; then
            # Custom format dump
            PGPASSWORD="$DB_PASSWORD" pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$decompressed_file"
            log_success "PostgreSQL database restored from custom dump"
        else
            log_error "Unknown backup file type: $decompressed_file"
            exit 1
        fi
        
        # Run Prisma migration to ensure schema is up to date
        log_info "Running Prisma migration..."
        export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"
        bunx prisma db push
        log_success "Prisma migration completed"
        
        # Clean up temporary files
        if [ "$decrypted_file" != "$decompressed_file" ]; then
            rm -f "$decrypted_file"
        fi
        if [ "$backup_file" != "$decompressed_file" ]; then
            rm -f "$decompressed_file"
        fi
    else
        log_info "[DRY RUN] Would restore PostgreSQL database from $backup_file"
    fi
}

# Main function
main() {
    log_info "=========================================="
    log_info "FirstLight Database Restore"
    log_info "=========================================="
    log_info ""
    
    log_info "Configuration:"
    log_info "  Database Type: $DB_TYPE"
    log_info "  Backup Directory: $BACKUP_DIR"
    log_info "  Backup File: ${BACKUP_FILE:-latest}"
    log_info "  Decrypt: $DECRYPT"
    log_info "  Drop Existing: $DROP_EXISTING"
    log_info "  Dry Run: ${DRY_RUN:-false}"
    log_info ""
    
    # Perform restore based on type
    if [ "$DB_TYPE" = "sqlite" ]; then
        restore_sqlite
    else
        restore_postgres
    fi
    
    log_info ""
    log_info "=========================================="
    log_info "Restore Summary"
    log_info "=========================================="
    log_info "Database Type: $DB_TYPE"
    
    if [ "$DB_TYPE" = "sqlite" ]; then
        log_info "SQLite Path: $SQLITE_PATH"
    else
        log_info "PostgreSQL: $DB_HOST:$DB_PORT/$DB_NAME"
    fi
    
    if [ "$DRY_RUN" != "true" ]; then
        log_success "Restore completed successfully!"
        log_info ""
        log_info "Next steps:"
        log_info "  1. Verify data in restored database"
        log_info "  2. Test application with restored database"
        log_info "  3. Clean up temporary files"
    else
        log_info "[DRY RUN] Restore would have completed successfully"
        log_info ""
        log_info "To perform actual restore, run without --dry-run flag"
    fi
    log_info "=========================================="
}

# Run main function
main "$@"
