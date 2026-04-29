import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity';

@Entity('password_reset_tokens')
@Index('idx_password_reset_tokens_usuario_id', ['usuario_id'])
@Index('idx_password_reset_tokens_expires_at', ['expires_at'])
export class PasswordResetToken {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  usuario_id!: string;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  usuario?: Usuario;

  @Column({ type: 'char', length: 64, unique: true })
  token_hash!: string;

  @Column({ type: 'timestamp with time zone' })
  expires_at!: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  consumed_at!: Date | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  requested_ip!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  requested_user_agent!: string | null;

  @CreateDateColumn({
    type: 'timestamp with time zone',
    default: () => 'NOW()',
  })
  created_at!: Date;
}
