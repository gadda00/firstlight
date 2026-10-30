#!/bin/bash
# FirstLight Database Backup Script
# Performs backup of SQLite or PostgreSQL database

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
BACKUP_DIR="${BACKUP_DIR:-./db-backup-$(date +%Y%m%d-%H%M%S)}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPRESS="${COMPRESS:-true}"
ENCRYPT="${ENCRYPT:-false}"
ENCRYPT_KEY="${ENCRYPT_KEY:-}"

# Show help
show_help() {
    cat << EOF
FirstLight Database Backup Script

Usage: $0 [OPTIONS]

Options:
  --db-type TYPE        Database type: sqlite, postgres, or auto (default: auto)
  --db-host HOST        Database host (default: localhost)
  --db-port PORT        Database port (default: 5432)
  --db-name NAME        Database name (default: firstlight)
  --db-user USER        Database user (default: firstlight)
  --db-password PASS    Database password
  --sqlite-path PATH    Path to SQLite database (default: db/firstlight.db)
  --backup-dir DIR      Backup directory (default: ./db-backup-TIMESTAMP)
  --retention-days N    Backup retention in days (default: 30)
  --compress            Compress backup files (default: true)
  --encrypt             Encrypt backup files (requires openssl)
  --encrypt-key KEY     Encryption key (required if --encrypt)
  --dry-run             Perform dry run
  --help                Show this help message

Examples:
  $0 --db-type sqlite
  $0 --db-type postgres --db-password secret123
  $0 --encrypt --encrypt-key mysecretkey
  $0 --retention-days 90

Note: For SQLite, only --sqlite-path is required.
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
        --retention-days)
            RETENTION_DAYS="$2"
            shift 2
            ;;
        --compress)
            COMPRESS="true"
            shift
            ;;
        --no-compress)
            COMPRESS="false"
            shift
            ;;
        --encrypt)
            ENCRYPT="true"
            shift
            ;;
        --encrypt-key)
            ENCRYPT_KEY="$2"
            shift 2
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

# Validate encryption
if [ "$ENCRYPT" = "true" ] && [ -z "$ENCRYPT_KEY" ]; then
    log_error "Encryption key is required when --encrypt is specified"
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
if [ "$DB_TYPE" = "sqlite" ] && [ ! -f "$SQLITE_PATH" ]; then
    log_error "SQLite database not found: $SQLITE_PATH"
    exit 1
fi

# Validate PostgreSQL
if [ "$DB_TYPE" = "postgres" ]; then
    if [ -z "$DB_PASSWORD" ]; then
        log_error "PostgreSQL password is required"
        show_help
        exit 1
    fi
    
    # Test connection
    if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
        log_error "Failed to connect to PostgreSQL"
        log_error "Host: $DB_HOST:$DB_PORT, Database: $DB_NAME, User: $DB_USER"
        exit 1
    fi
fi

# Create backup directory
if [ "$DRY_RUN" != "true" ]; then
    log_info "Creating backup directory: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
fi

# Backup function for SQLite
backup_sqlite() {
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local backup_file="$BACKUP_DIR/firstlight-sqlite-$timestamp.db"
    local dump_file="$BACKUP_DIR/firstlight-sqlite-$timestamp.sql"
    
    log_info "Backing up SQLite database..."
    
    if [ "$DRY_RUN" != "true" ]; then
        # Copy database file
        cp "$SQLITE_PATH" "$backup_file"
        
        # Create SQL dump
        sqlite3 "$SQLITE_PATH" ".dump" > "$dump_file"
        
        # Compress if requested
        if [ "$COMPRESS" = "true" ]; then
            log_info "Compressing backup files..."
            gzip "$backup_file"
            gzip "$dump_file"
            backup_file="$backup_file.gz"
            dump_file="$dump_file.gz"
        fi
        
        # Encrypt if requested
        if [ "$ENCRYPT" = "true" ]; then
            log_info "Encrypting backup files..."
            openssl enc -aes-256-cbc -salt -in "$backup_file" -out "$backup_file.enc" -pass pass:"$ENCRYPT_KEY"
            openssl enc -aes-256-cbc -salt -in "$dump_file" -out "$dump_file.enc" -pass pass:"$ENCRYPT_KEY"
            rm "$backup_file" "$dump_file"
            backup_file="$backup_file.enc"
            dump_file="$dump_file.enc"
        fi
        
        log_success "SQLite backup completed"
        log_info "  Database file: $backup_file"
        log_info "  SQL dump: $dump_file"
        
        # Calculate size
        local size=$(du -sh "$BACKUP_DIR" | cut -f1)
        log_info "  Total size: $size"
    else
        log_info "[DRY RUN] Would backup SQLite database to $BACKUP_DIR"
    fi
}

# Backup function for PostgreSQL
backup_postgres() {
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local dump_file="$BACKUP_DIR/firstlight-postgres-$timestamp.sql"
    local custom_file="$BACKUP_DIR/firstlight-postgres-$timestamp.custom"
    
    log_info "Backing up PostgreSQL database..."
    
    if [ "$DRY_RUN" != "true" ]; then
        # Create SQL dump
        PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F c -f "$dump_file"
        
        # Create plain SQL dump
        PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" > "$custom_file"
        
        # Compress if requested
        if [ "$COMPRESS" = "true" ]; then
            log_info "Compressing backup files..."
            gzip "$dump_file"
            gzip "$custom_file"
            dump_file="$dump_file.gz"
            custom_file="$custom_file.gz"
        fi
        
        # Encrypt if requested
        if [ "$ENCRYPT" = "true" ]; then
            log_info "Encrypting backup files..."
            openssl enc -aes-256-cbc -salt -in "$dump_file" -out "$dump_file.enc" -pass pass:"$ENCRYPT_KEY"
            openssl enc -aes-256-cbc -salt -in "$custom_file" -out "$custom_file.enc" -pass pass:"$ENCRYPT_KEY"
            rm "$dump_file" "$custom_file"
            dump_file="$dump_file.enc"
            custom_file="$custom_file.enc"
        fi
        
        log_success "PostgreSQL backup completed"
        log_info "  Custom dump: $custom_file"
        log_info "  Compressed dump: $dump_file"
        
        # Calculate size
        local size=$(du -sh "$BACKUP_DIR" | cut -f1)
        log_info "  Total size: $size"
    else
        log_info "[DRY RUN] Would backup PostgreSQL database to $BACKUP_DIR"
    fi
}

# Cleanup old backups
cleanup_old_backups() {
    if [ "$DRY_RUN" != "true" ]; then
        log_info "Cleaning up backups older than $RETENTION_DAYS days..."
        find "$(dirname "$BACKUP_DIR")" -maxdepth 1 -type d -name 'db-backup-*' -mtime +"$RETENTION_DAYS" -exec rm -rf {} \;
        log_success "Old backups cleaned up"
    else
        log_info "[DRY RUN] Would clean up backups older than $RETENTION_DAYS days"
    fi
}

# Main function
main() {
    log_info "=========================================="
    log_info "FirstLight Database Backup"
    log_info "=========================================="
    log_info ""
    
    log_info "Configuration:"
    log_info "  Database Type: $DB_TYPE"
    log_info "  Backup Directory: $BACKUP_DIR"
    log_info "  Retention Days: $RETENTION_DAYS"
    log_info "  Compress: $COMPRESS"
    log_info "  Encrypt: $ENCRYPT"
    log_info "  Dry Run: ${DRY_RUN:-false}"
    log_info ""
    
    # Perform backup based on type
    if [ "$DB_TYPE" = "sqlite" ]; then
        backup_sqlite
    else
        backup_postgres
    fi
    
    log_info ""
    
    # Cleanup old backups
    cleanup_old_backups
    
    log_info ""
    log_info "=========================================="
    log_info "Backup Summary"
    log_info "=========================================="
    log_info "Database Type: $DB_TYPE"
    log_info "Backup Directory: $BACKUP_DIR"
    
    if [ "$DRY_RUN" != "true" ]; then
        log_success "Backup completed successfully!"
        log_info ""
        log_info "Next steps:"
        log_info "  1. Verify backup files in $BACKUP_DIR"
        log_info "  2. Test restore procedure"
        log_info "  3. Store backups in secure location"
    else
        log_info "[DRY RUN] Backup would have completed successfully"
        log_info ""
        log_info "To perform actual backup, run without --dry-run flag"
    fi
    log_info "=========================================="
}

# Run main function
main "$@"
